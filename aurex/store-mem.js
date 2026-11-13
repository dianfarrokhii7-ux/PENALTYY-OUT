'use strict';
// In-memory store: same contract as store-pg.js. Used by tests and local dev only (never in production).
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
const dupErr = code => Object.assign(new Error(code), { code });

function create() {
  const S = { users: [], sessions: new Map(), teams: [], members: [], audit: [], owner: false, seq: 0, uid: 0, tid: 0, aid: 0 };
  const userOut = u => (u ? { id: u.id, username: u.username, role: u.role, status: u.status, createdAt: u.createdAt, passHash: u.passHash, recoveryHash: u.recoveryHash } : null);
  const memberRows = tid => S.members.filter(m => m.teamId === tid).sort((a, b) => a.slot - b.slot)
    .map(m => ({ userId: m.userId, username: S.users.find(u => u.id === m.userId).username, slot: m.slot }));
  const teamOut = t => (t ? {
    id: t.id, name: t.name, teamCode: t.teamCode, status: t.status, captainId: t.captainId, createdBy: t.createdBy,
    rejectReason: t.rejectReason, suspendReason: t.suspendReason, decidedBy: t.decidedBy, decidedAt: t.decidedAt,
    createdAt: t.createdAt, hasLogo: !!t.logo, members: memberRows(t.id),
  } : null);

  return {
    kind: 'memory',
    async migrate() {},
    async close() {},
    // users
    async createUser({ username, passHash, recoveryHash }) {
      if (S.users.some(u => u.lower === username.toLowerCase())) throw dupErr('DUP_USER');
      const u = { id: ++S.uid, username, lower: username.toLowerCase(), passHash, recoveryHash, role: 'PLAYER', status: 'active', createdAt: new Date().toISOString() };
      S.users.push(u); return userOut(u);
    },
    async getUserByUsername(name) { return userOut(S.users.find(u => u.lower === String(name).toLowerCase())); },
    async getUserById(id) { return userOut(S.users.find(u => u.id === id)); },
    async updateUser(id, patch) {
      const u = S.users.find(x => x.id === id); if (!u) return null;
      for (const k of ['passHash', 'recoveryHash', 'status', 'role']) if (patch[k] !== undefined) u[k] = patch[k];
      return userOut(u);
    },
    async listUsers() {
      return S.users.map(u => {
        const m = S.members.filter(x => x.userId === u.id).map(x => S.teams.find(t => t.id === x.teamId)).sort((a, b) => b.id - a.id)[0];
        return { ...userOut(u), passHash: undefined, recoveryHash: undefined, team: m ? { id: m.id, name: m.name, teamCode: m.teamCode, status: m.status } : null };
      });
    },
    async countOwners() { return S.users.filter(u => u.role === 'OWNER').length; },
    async claimOwner(userId) {
      if (S.owner) return false; S.owner = true;
      S.users.find(u => u.id === userId).role = 'OWNER'; return true;
    },
    // sessions
    async createSession({ userId, tokenHash, expiresAt, userAgent }) { S.sessions.set(tokenHash, { userId, expiresAt: +new Date(expiresAt), userAgent }); },
    async getSession(tokenHash) {
      const s = S.sessions.get(tokenHash); if (!s) return null;
      if (s.expiresAt <= Date.now()) { S.sessions.delete(tokenHash); return null; }
      return { user: userOut(S.users.find(u => u.id === s.userId)), expiresAt: new Date(s.expiresAt) };
    },
    async deleteSession(tokenHash) { S.sessions.delete(tokenHash); },
    async deleteUserSessions(userId, exceptHash) { for (const [h, s] of S.sessions) if (s.userId === userId && h !== exceptHash) S.sessions.delete(h); },
    async purgeExpiredSessions() { for (const [h, s] of S.sessions) if (s.expiresAt <= Date.now()) S.sessions.delete(h); },
    // teams
    async createTeam({ name, passHash, logo, createdBy, memberIds }) {
      const lower = name.toLowerCase();
      if (S.teams.some(t => t.status !== 'rejected' && t.lower === lower)) throw dupErr('DUP_TEAM');
      for (const id of memberIds) if (S.members.some(m => m.userId === id && m.active)) throw dupErr('MEMBER_BUSY');
      const t = { id: ++S.tid, name, lower, passHash, logo: logo || null, status: 'pending', teamCode: null, captainId: createdBy, createdBy,
        rejectReason: null, suspendReason: null, decidedBy: null, decidedAt: null, createdAt: new Date().toISOString() };
      S.teams.push(t); memberIds.forEach((userId, i) => S.members.push({ teamId: t.id, userId, slot: i + 1, active: true }));
      return teamOut(t);
    },
    async getTeamById(id) { return teamOut(S.teams.find(t => t.id === id)); },
    async getTeamPassHash(id) { const t = S.teams.find(x => x.id === id); return t ? t.passHash : null; },
    async getActiveTeamForUser(userId) {
      const m = S.members.find(x => x.userId === userId && x.active); return m ? teamOut(S.teams.find(t => t.id === m.teamId)) : null;
    },
    async getLatestTeamForUser(userId) {
      const ts = S.members.filter(x => x.userId === userId).map(x => S.teams.find(t => t.id === x.teamId)).sort((a, b) => b.id - a.id);
      return teamOut(ts[0]);
    },
    async listTeams({ status } = {}) { return S.teams.filter(t => !status || t.status === status).sort((a, b) => b.id - a.id).map(teamOut); },
    async updateTeam(id, patch) {
      const t = S.teams.find(x => x.id === id); if (!t) return null;
      if (patch.teamCode && S.teams.some(x => x.id !== id && x.teamCode === patch.teamCode)) throw dupErr('DUP_CODE');
      for (const k of ['status', 'teamCode', 'captainId', 'rejectReason', 'suspendReason', 'decidedBy', 'decidedAt']) if (patch[k] !== undefined) t[k] = patch[k];
      return teamOut(t);
    },
    async releaseMembers(teamId) { S.members.filter(m => m.teamId === teamId).forEach(m => { m.active = false; }); },
    async nextTeamNumber() { return ++S.seq; },
    async getLogo(teamId) { const t = S.teams.find(x => x.id === teamId); return t && t.logo ? { mime: t.logo.mime, data: Buffer.from(t.logo.data) } : null; },
    // audit
    async addAudit({ actorId, action, targetType, targetId, detail }) {
      S.audit.push({ id: ++S.aid, actorId, action, targetType: targetType || null, targetId: targetId == null ? null : String(targetId), detail: clone(detail) || null, createdAt: new Date().toISOString() });
    },
    async listAudit(limit = 100) {
      return S.audit.slice(-limit).reverse().map(a => ({ ...a, actor: (S.users.find(u => u.id === a.actorId) || {}).username || null }));
    },
  };
}
module.exports = { create };
