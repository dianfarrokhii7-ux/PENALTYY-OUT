'use strict';
// Business rules. Everything here runs on the server; the browser is never trusted.
const C = require('./crypto');
const V = require('./validate');
const { err } = require('./errors');

const SESSION_MS = 30 * 24 * 3600 * 1000;
const MIN = 60e3, HOUR = 3600e3;

function createLimiter() {
  const hits = new Map();
  const t = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }, MIN);
  if (t.unref) t.unref();
  return {
    hit(key, max, windowMs) {
      const now = Date.now(); let e = hits.get(key);
      if (!e || e.reset <= now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
      if (++e.n > max) throw err(429, 'RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.', { retryAfter: Math.ceil((e.reset - now) / 1000) });
    },
    clear(key) { hits.delete(key); },
  };
}

const publicUser = u => ({ id: u.id, username: u.username, role: u.role, status: u.status, createdAt: u.createdAt });
const teamView = (t, { secret } = {}) => {
  const cap = t.members.find(m => m.userId === t.captainId);
  return { id: t.id, name: t.name, teamCode: t.teamCode, status: t.status, captainId: t.captainId, captain: cap ? cap.username : null,
    members: t.members, hasLogo: t.hasLogo, createdAt: t.createdAt,
    ...(secret ? { rejectReason: t.rejectReason, suspendReason: t.suspendReason, decidedAt: t.decidedAt } : {}) };
};
const LIVE = new Set(['approved', 'active']);

function createCore({ store, env = process.env }) {
  const limiter = createLimiter();
  const DUMMY = C.hashSecret('timing-equalizer-not-a-real-password');
  const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  async function newSession(user, ua) {
    const token = C.randomToken();
    await store.createSession({ userId: user.id, tokenHash: C.sha256(token), expiresAt: new Date(Date.now() + SESSION_MS), userAgent: String(ua || '').slice(0, 200) });
    return { token, user: publicUser(user) };
  }
  async function authenticate(token) {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    const hash = C.sha256(token);
    const s = await store.getSession(hash);
    if (!s) return null;
    if (s.user.status !== 'active') { await store.deleteSession(hash); return null; }
    return { user: s.user, tokenHash: hash };
  }
  const audit = (actor, action, targetType, targetId, detail) => store.addAudit({ actorId: actor.id, action, targetType, targetId, detail });
  function assertOwner(actor) { if (!actor || actor.role !== 'OWNER' || actor.status !== 'active') throw err(403, 'FORBIDDEN', 'Owner access required.'); }

  // ---------- accounts ----------
  async function register(ip, ua, b) {
    limiter.hit('reg:' + ip, 10, HOUR);
    const name = V.username(b.username); V.password(b.password, name);
    if (b.password !== b.confirmPassword) throw err(400, 'PASSWORD_MISMATCH', 'Passwords do not match.', { field: 'confirmPassword' });
    const recoveryCode = C.makeRecoveryCode();
    const [passHash, recoveryHash] = await Promise.all([C.hashSecret(b.password), C.hashSecret(C.normRecovery(recoveryCode))]);
    let user;
    try { user = await store.createUser({ username: name, passHash, recoveryHash }); }
    catch (e) { if (e.code === 'DUP_USER') throw err(409, 'USERNAME_TAKEN', 'That username is already taken.', { field: 'username' }); throw e; }
    const s = await newSession(user, ua);
    return { ...s, recoveryCode }; // role is always PLAYER here – nothing in the request can change that
  }
  async function login(ip, ua, b) {
    const name = str(b.username, 40).toLowerCase();
    limiter.hit('login:ip:' + ip, 40, 15 * MIN);
    if (name) limiter.hit('login:u:' + name, 8, 15 * MIN);
    const user = name && typeof b.password === 'string' && b.password.length <= 128 ? await store.getUserByUsername(name) : null;
    const ok = await C.verifySecret(typeof b.password === 'string' ? b.password.slice(0, 128) : '', user ? user.passHash : await DUMMY);
    if (!user || !ok) throw err(401, 'INVALID_CREDENTIALS', 'Wrong username or password.');
    if (user.status !== 'active') throw err(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact the tournament owner.');
    limiter.clear('login:u:' + name);
    return newSession(user, ua);
  }
  const logout = tokenHash => store.deleteSession(tokenHash);
  async function me(user) {
    const team = await store.getLatestTeamForUser(user.id);
    return { user: publicUser(user), team: team ? teamView(team, { secret: true }) : null };
  }
  async function changePassword(user, tokenHash, b) {
    limiter.hit('chpw:' + user.id, 8, 15 * MIN);
    if (!(await C.verifySecret(String(b.oldPassword || '').slice(0, 128), user.passHash))) throw err(403, 'WRONG_PASSWORD', 'Current password is wrong.', { field: 'oldPassword' });
    V.password(b.newPassword, user.username);
    if (b.newPassword !== b.confirmPassword) throw err(400, 'PASSWORD_MISMATCH', 'Passwords do not match.', { field: 'confirmPassword' });
    await store.updateUser(user.id, { passHash: await C.hashSecret(b.newPassword) });
    await store.deleteUserSessions(user.id, tokenHash); // sign out every other device
    return { ok: true };
  }
  async function recover(ip, b) {
    const name = str(b.username, 40).toLowerCase();
    limiter.hit('rec:ip:' + ip, 10, HOUR); limiter.hit('rec:u:' + name, 5, HOUR);
    const fail = () => err(400, 'INVALID_RECOVERY', 'Username or recovery code is not correct.');
    const user = name ? await store.getUserByUsername(name) : null;
    const ok = await C.verifySecret(C.normRecovery(b.recoveryCode).slice(0, 32), user ? user.recoveryHash : await DUMMY);
    if (!user || !ok) throw fail();
    V.password(b.newPassword, user.username);
    if (b.newPassword !== b.confirmPassword) throw err(400, 'PASSWORD_MISMATCH', 'Passwords do not match.', { field: 'confirmPassword' });
    const recoveryCode = C.makeRecoveryCode(); // single use: a fresh code replaces the one just spent
    await store.updateUser(user.id, { passHash: await C.hashSecret(b.newPassword), recoveryHash: await C.hashSecret(C.normRecovery(recoveryCode)) });
    await store.deleteUserSessions(user.id);
    limiter.clear('rec:u:' + name);
    return { ok: true, recoveryCode };
  }

  // ---------- owner bootstrap (one-shot, server-side key) ----------
  async function bootstrapOwner(ip, user, b) {
    const key = env.AUREX_OWNER_KEY;
    if (!key || key.length < 24) throw err(404, 'NOT_FOUND', 'Not found.');
    if ((await store.countOwners()) > 0) throw err(404, 'NOT_FOUND', 'Not found.'); // closed for good once an owner exists
    limiter.hit('boot:ip:' + ip, 5, HOUR); limiter.hit('boot:u:' + user.id, 5, HOUR);
    if (typeof b.key !== 'string' || !C.safeEqual(b.key, key)) throw err(403, 'BAD_KEY', 'That activation key is not valid.');
    if (!(await store.claimOwner(user.id))) throw err(404, 'NOT_FOUND', 'Not found.');
    await store.addAudit({ actorId: user.id, action: 'owner.bootstrap', targetType: 'user', targetId: user.id });
    return { ok: true, role: 'OWNER' };
  }

  // ---------- teams (player side) ----------
  async function registerTeam(user, b) {
    limiter.hit('team:' + user.id, 12, HOUR);
    const name = V.teamName(b.name), tpw = V.teamPassword(b.teamPassword), logo = V.logo(b.logo);
    if (str(b.player1Username, 40).toLowerCase() !== user.username.toLowerCase()) throw err(400, 'PLAYER1_MUST_BE_YOU', 'Player 1 must be your own account.', { field: 'player1Username' });
    const p2name = V.username(b.player2Username);
    if (p2name.toLowerCase() === user.username.toLowerCase()) throw err(400, 'SAME_PLAYER', 'A team needs two different players.', { field: 'player2Username' });
    const p2 = await store.getUserByUsername(p2name);
    if (!p2 || p2.status !== 'active') throw err(404, 'PLAYER2_NOT_FOUND', 'Player 2 does not have an active AUREX account.', { field: 'player2Username' });
    if (await store.getActiveTeamForUser(user.id)) throw err(409, 'ALREADY_IN_TEAM', 'You already belong to a team.');
    if (await store.getActiveTeamForUser(p2.id)) throw err(409, 'PLAYER2_BUSY', 'Player 2 already belongs to another team.', { field: 'player2Username' });
    try {
      const t = await store.createTeam({ name, passHash: await C.hashSecret(tpw), logo, createdBy: user.id, memberIds: [user.id, p2.id] });
      return teamView(t, { secret: true });
    } catch (e) {
      if (e.code === 'DUP_TEAM') throw err(409, 'TEAM_NAME_TAKEN', 'That team name is already in use.', { field: 'name' });
      if (e.code === 'MEMBER_BUSY') throw err(409, 'ALREADY_IN_TEAM', 'One of the players already belongs to a team.');
      throw e;
    }
  }
  async function publicTeams() { return (await store.listTeams()).filter(t => LIVE.has(t.status)).map(t => teamView(t)); }
  async function teamLogo(user, id) {
    const t = await store.getTeamById(id); if (!t || !t.hasLogo) return null;
    const allowed = LIVE.has(t.status) || (user && (user.role === 'OWNER' || t.members.some(m => m.userId === user.id)));
    return allowed ? store.getLogo(id) : null;
  }
  async function setCaptainByTeam(user, b) {
    limiter.hit('cap:' + user.id, 6, 15 * MIN);
    const t = await store.getActiveTeamForUser(user.id);
    if (!t || t.status === 'rejected') throw err(404, 'NO_TEAM', 'You are not on a team.');
    if (t.captainId !== user.id) throw err(403, 'NOT_CAPTAIN', 'Only the current captain can hand over the armband.');
    if (!(await C.verifySecret(String(b.teamPassword || '').slice(0, 64), await store.getTeamPassHash(t.id)))) throw err(403, 'WRONG_TEAM_PASSWORD', 'Team password is wrong.', { field: 'teamPassword' });
    const target = t.members.find(m => m.userId === +b.userId);
    if (!target) throw err(400, 'NOT_A_MEMBER', 'Pick a member of your team.');
    return teamView(await store.updateTeam(t.id, { captainId: target.userId }), { secret: true });
  }

  // ---------- owner panel ----------
  async function mustTeam(id) { const t = await store.getTeamById(id); if (!t) throw err(404, 'TEAM_NOT_FOUND', 'Team not found.'); return t; }
  const bad = (t, what) => err(409, 'BAD_STATE', `Cannot ${what}: team is ${t.status}.`);
  const admin = {
    async listTeams(actor, status) { assertOwner(actor); return (await store.listTeams({ status: status || undefined })).map(t => teamView(t, { secret: true })); },
    async getTeam(actor, id) { assertOwner(actor); return teamView(await mustTeam(id), { secret: true }); },
    async approve(actor, id, b) {
      assertOwner(actor); const t = await mustTeam(id);
      if (t.status !== 'pending') throw bad(t, 'approve');
      const code = 'AX-' + String(await store.nextTeamNumber()).padStart(4, '0');
      const out = await store.updateTeam(id, { status: b.activate ? 'active' : 'approved', teamCode: code, decidedBy: actor.id, decidedAt: new Date().toISOString(), rejectReason: null });
      await audit(actor, 'team.approve', 'team', id, { teamCode: code, activated: !!b.activate });
      return teamView(out, { secret: true });
    },
    async reject(actor, id, b) {
      assertOwner(actor); const t = await mustTeam(id);
      if (t.status !== 'pending') throw bad(t, 'reject');
      const reason = str(b.reason, 300); if (reason.length < 3) throw err(400, 'REASON_REQUIRED', 'Write a short reason so the players know what to fix.', { field: 'reason' });
      await store.releaseMembers(id); // players are free to register again
      const out = await store.updateTeam(id, { status: 'rejected', rejectReason: reason, decidedBy: actor.id, decidedAt: new Date().toISOString() });
      await audit(actor, 'team.reject', 'team', id, { reason });
      return teamView(out, { secret: true });
    },
    async activate(actor, id) {
      assertOwner(actor); const t = await mustTeam(id);
      if (!['approved', 'suspended'].includes(t.status)) throw bad(t, 'activate');
      const out = await store.updateTeam(id, { status: 'active', suspendReason: null });
      await audit(actor, 'team.activate', 'team', id, { from: t.status });
      return teamView(out, { secret: true });
    },
    async suspend(actor, id, b) {
      assertOwner(actor); const t = await mustTeam(id);
      if (!['approved', 'active'].includes(t.status)) throw bad(t, 'suspend');
      const reason = str(b.reason, 300); if (reason.length < 3) throw err(400, 'REASON_REQUIRED', 'Write a short reason for the suspension.', { field: 'reason' });
      const out = await store.updateTeam(id, { status: 'suspended', suspendReason: reason });
      await audit(actor, 'team.suspend', 'team', id, { reason });
      return teamView(out, { secret: true });
    },
    async setCaptain(actor, id, b) {
      assertOwner(actor); const t = await mustTeam(id);
      if (t.status === 'rejected') throw bad(t, 'change the captain');
      if (!t.members.some(m => m.userId === +b.userId)) throw err(400, 'NOT_A_MEMBER', 'Captain must be a member of the team.');
      const out = await store.updateTeam(id, { captainId: +b.userId });
      await audit(actor, 'team.captain', 'team', id, { from: t.captainId, to: +b.userId });
      return teamView(out, { secret: true });
    },
    async setTeamCode(actor, id, b) {
      assertOwner(actor); const t = await mustTeam(id);
      if (!t.teamCode) throw err(409, 'NO_TEAM_ID', 'Team ID is created when the team is approved.');
      const code = str(b.teamCode, 12).toUpperCase();
      if (!/^AX-\d{4,6}$/.test(code)) throw err(400, 'INVALID_TEAM_ID', 'Team ID looks like AX-0007.', { field: 'teamCode' });
      try { const out = await store.updateTeam(id, { teamCode: code }); await audit(actor, 'team.team_id', 'team', id, { from: t.teamCode, to: code }); return teamView(out, { secret: true }); }
      catch (e) { if (e.code === 'DUP_CODE') throw err(409, 'TEAM_ID_TAKEN', 'Another team already uses that Team ID.', { field: 'teamCode' }); throw e; }
    },
    async listPlayers(actor) { assertOwner(actor); return store.listUsers(); },
    async setPlayerStatus(actor, id, status, b) {
      assertOwner(actor);
      const u = await store.getUserById(id); if (!u) throw err(404, 'USER_NOT_FOUND', 'Player not found.');
      if (u.id === actor.id) throw err(400, 'SELF_ACTION', 'You cannot suspend your own account.');
      if (u.role === 'OWNER') throw err(403, 'OWNER_PROTECTED', 'Owner accounts cannot be suspended.');
      const out = await store.updateUser(id, { status });
      if (status === 'suspended') await store.deleteUserSessions(id);
      await audit(actor, status === 'suspended' ? 'player.suspend' : 'player.unsuspend', 'user', id, { reason: str(b.reason, 300) || null });
      return publicUser(out);
    },
    async setRole(actor, id, b) {
      assertOwner(actor); limiter.hit('role:' + actor.id, 6, 15 * MIN);
      if (!(await C.verifySecret(String(b.password || '').slice(0, 128), actor.passHash))) throw err(403, 'WRONG_PASSWORD', 'Confirm with your own password.', { field: 'password' });
      if (!['PLAYER', 'OWNER'].includes(b.role)) throw err(400, 'INVALID_ROLE', 'Role must be PLAYER or OWNER.');
      const u = await store.getUserById(id); if (!u) throw err(404, 'USER_NOT_FOUND', 'Player not found.');
      if (u.id === actor.id) throw err(400, 'SELF_ACTION', 'You cannot change your own role.');
      if (u.status !== 'active') throw err(409, 'USER_SUSPENDED', 'Unsuspend the account first.');
      const out = await store.updateUser(id, { role: b.role });
      await audit(actor, 'player.role', 'user', id, { from: u.role, to: b.role });
      return publicUser(out);
    },
    async listAudit(actor) { assertOwner(actor); return store.listAudit(150); },
  };

  return { authenticate, register, login, logout, me, changePassword, recover, bootstrapOwner, registerTeam, publicTeams, teamLogo, setCaptainByTeam, admin, limiter, purge: () => store.purgeExpiredSessions() };
}
module.exports = { createCore, publicUser, teamView };
