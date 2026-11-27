'use strict';
/*
 * AUREX PENALTY CUP – online duel (Socket.IO namespace /aurex-pen).
 *
 * Two signed-in AUREX players from two DIFFERENT active teams. One kicks, the other keeps goal, roles swap after every kick.
 * The server is the only authority: it runs the physics, the AI referee / VAR, the shootout rules and it writes the result once.
 * It never trusts the browser; it only accepts small intents (aim, power, keeper movement, dive) and clamps all of them.
 * Nothing here touches accounts, teams or any other AUREX table.
 */
const crypto = require('crypto');
const Rules = require('./pen-rules');
const P = require('./pen-physics');
const { judge } = require('./pen-ai');
const { C } = P;

const DEFAULT_TIMING = { aimMs: 25000, introMs: 10000, openingExtraMs: 18000, finalExtraMs: 9000, whistleMs: 1600, resultMs: 3600, varExtraMs: 1200, retakeMs: 2600, reconnectMs: 60000, queueMs: 180000, tickMs: 40, streamMs: 50, lookMs: 250, cleanupMs: 90000 };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sgn = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

function attach(io, { store, api }, opts = {}) {
  const core = api.core, T = { ...DEFAULT_TIMING, ...(opts.timing || {}) };
  const RUN = T.runupMs || C.RUNUP_MS, FDELAY = T.feintDelayMs || C.FEINT_DELAY_MS, S = opts.timeScale || 1;   // S > 1 only in tests (faster than real time)
  const rng = opts.rng || Math.random, now = opts.now || Date.now;
  const REQUIRE_HOST = opts.requireHost !== false;     // announced league / semi-final / final matches are started by the OWNER (he enters the room as host)
  const nsp = io.of('/aurex-pen');
  const rooms = new Map();            // code -> room
  const userRoom = new Map();         // userId -> room
  const userSocket = new Map();       // userId -> socket
  let queue = [];                     // [{ userId, at }]

  /* ---------------------------------------------------------------- helpers */
  const LETTERS = CODE_CHARS.replace(/[2-9]/g, '');
  const newCode = () => { let c; do { c = LETTERS[Math.floor(rng() * LETTERS.length)] + Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)]).join(''); } while (rooms.has(c)); return c; };
  const emit = (r, ev, data) => nsp.to(r.code).emit(ev, { ...data, ts: now() });
  // a "side" is one TEAM in the duel: 1 or 2 registered members of that team (solo play is allowed)
const memberView = m => ({ userId: m.userId, username: m.username, on: m.on, ready: m.ready });
const pub = s => s ? { team: s.team, members: s.members.map(memberView), on: s.members.some(m => m.on), ready: s.members.length > 0 && s.members.every(m => m.ready), yellow: s.yellow, userId: s.members[0] && s.members[0].userId, username: s.members.map(m => m.username).join(' & ') } : null;
const MAX_MEMBERS = 2;
  const clearTimers = r => { for (const k of Object.keys(r.t)) { clearTimeout(r.t[k]); clearInterval(r.t[k]); } r.t = {}; };
  const scoreView = r => r.sh ? { kicks: [...r.sh.kicks], goals: [...r.sh.goals], log: r.sh.log.map(l => l.map(e => ({ ...e }))), first: r.sh.first } : null;
  const needsHost = r => REQUIRE_HOST && !!r.fixture;
  const sidesReady = r => !!(r.players[0] && r.players[1]) && r.players.every(sd => sd.members.length > 0 && sd.members.every(m => m.ready));
  const hostKey = r => r.code + ':host';
  const roomView = r => ({ code: r.code, phase: r.phase, league: r.stage !== 'friendly', stage: r.stage, players: r.players.map(pub), needsHost: needsHost(r), host: r.host ? { userId: r.host.userId, username: r.host.username } : null, awaitingHost: needsHost(r) && r.phase === 'lobby' && sidesReady(r), ...(r.sh ? scoreView(r) : {}) });

  async function playerInfo(user) {
    const team = await store.getActiveTeamForUser(user.id);
    if (!team || team.status !== 'active') return { error: 'Your AUREX team must be ACTIVE (approved and activated by the owner) to play.' };
    let club = null; try { club = typeof store.getClubSelection === 'function' ? await store.getClubSelection(team.id) : null; } catch (_) { club = null; }
    return { team: { id: team.id, name: team.name, teamCode: team.teamCode, hasLogo: !!team.hasLogo, club: club ? { id: club.id, short: club.short, name: club.name, colors: club.colors } : null } };
  }

  /* ---------------------------------------------------------------- auth */
  nsp.use(async (socket, next) => {
    try {
      const h = socket.handshake.headers || {}, origin = h.origin;
      if (origin && origin !== 'null') { let host; try { host = new URL(origin).host; } catch (_) { host = null; } if (host !== h.host) return next(new Error('FORBIDDEN_ORIGIN')); }
      const m = /(?:^|; *)aurex_sid=([^;]+)/.exec(h.cookie || '');
      const s = m ? await core.authenticate(m[1]) : null;
      if (!s) return next(new Error('AUTH_REQUIRED'));
      const info = await playerInfo(s.user);
      socket.data = { user: { id: s.user.id, username: s.user.username, role: s.user.role }, team: info.team || null, teamError: info.error || null };
      next();
    } catch (e) { next(new Error('AUTH_FAILED')); }
  });

  /* ---------------------------------------------------------------- rooms */
  /** A friendly room (random code that starts with a LETTER) or the room of an announced league fixture (its own code, starts with a digit). */
  function makeRoom(fixture) {
    const r = { code: fixture ? fixture.roomCode : newCode(), id: crypto.randomUUID(), phase: 'lobby', players: [null, null], league: false, stage: fixture ? fixture.stage : 'friendly', fixture: fixture || null, sh: null, t: {}, turn: null, waiting: false, saved: false, varCount: 0, vars: [], createdAt: now(), ended: false, specs: new Set(), host: null };
    rooms.set(r.code, r); return r;
  }
  /** Seats a user on the side of HIS team (a second registered member joins his teammate's side) or on a free side. Returns the side index or -1. */
  function seat(r, sock) {
    const u = sock.data.user, team = sock.data.team;
    let i = r.players.findIndex(x => x && x.team.id === team.id);
    if (i < 0) { i = r.players[0] ? (r.players[1] ? -1 : 1) : 0; if (i < 0) return -1; r.players[i] = { team, members: [], yellow: 0, kp: { x: 0, kz: 0 }, inp: { mx: 0, mz: 0 }, dt: null }; }
    const side = r.players[i]; if (side.members.length >= MAX_MEMBERS) return -1;
    side.members.push({ userId: u.id, username: u.username, on: true, ready: false, yellow: 0 });
    userRoom.set(u.id, r); sock.join(r.code); queue = queue.filter(q => q.userId !== u.id);
    return i;
  }
  const memberOf = (r, userId) => { for (const sd of r.players) { const m = sd && sd.members.find(x => x.userId === userId); if (m) return m; } return null; };
  const idxOf = (r, userId) => r.players.findIndex(s => s && s.members.some(m => m.userId === userId));
  function destroy(r) { clearTimers(r); if (r.host) { const hs = r.host.socket; r.host = null; hs.data.host = null; try { hs.leave(hostKey(r)); } catch (_) { } hs.emit('host:end', { code: r.code }); } for (const s of [...r.specs]) { s.data.spec = null; try { s.leave(r.code); } catch (_) { } s.emit('spec:end', { code: r.code }); } r.specs.clear(); for (const sd of r.players) if (sd) for (const m of sd.members) if (userRoom.get(m.userId) === r) userRoom.delete(m.userId); rooms.delete(r.code); }
  function lobbyUpdate(r) { emit(r, 'lobby', { room: roomView(r) }); if (r.host) nsp.to(hostKey(r)).emit('lobby', { room: roomView(r), ts: now() }); }

  function checkEligible(sock) {
    if (sock.data.teamError) { sock.emit('err', { code: 'TEAM_NOT_ACTIVE', message: sock.data.teamError }); return false; }
    return true;
  }
  function leaveLobby(sock) {
    const r = userRoom.get(sock.data.user.id);
    queue = queue.filter(q => q.userId !== sock.data.user.id);
    if (!r || r.phase !== 'lobby') return;
    const i = idxOf(r, sock.data.user.id); sock.leave(r.code); userRoom.delete(sock.data.user.id);
    if (i >= 0) { const sd = r.players[i]; sd.members = sd.members.filter(m => m.userId !== sock.data.user.id); if (!sd.members.length) r.players[i] = null; }
    if (r.players[0] === null && r.players[1]) { r.players[0] = r.players[1]; r.players[1] = null; }
    if (!r.players[0] && !r.host) destroy(r); else { r.players.forEach(sd => { if (sd) sd.members.forEach(m => { m.ready = false; }); }); lobbyUpdate(r); }
  }
  function tryQuick(sock) {
    const me = sock.data.user.id;
    const cand = queue.find(q => q.userId !== me && userSocket.get(q.userId) && userSocket.get(q.userId).data.team && userSocket.get(q.userId).data.team.id !== sock.data.team.id && now() - q.at < T.queueMs);
    if (!cand) { queue = queue.filter(q => q.userId !== me); queue.push({ userId: me, at: now() }); sock.emit('queue', { waiting: true }); return; }
    const other = userSocket.get(cand.userId); queue = queue.filter(q => q.userId !== cand.userId && q.userId !== me);
    const r = makeRoom(); seat(r, other); seat(r, sock);
    other.emit('joined', { you: 0, uid: other.data.user.id, code: r.code, room: roomView(r), ts: now() }); sock.emit('joined', { you: 1, uid: sock.data.user.id, code: r.code, room: roomView(r), ts: now() }); lobbyUpdate(r);
  }


  /* ---------------------------------------------------------------- opening ceremony (first league match of the cup) */
  const liveTeam = t => ({ id: t.id, name: t.name, hasLogo: !!t.hasLogo });
  /** The names of the reporters (گزارشگر) who are watching this room right now, in the order they joined (max 3, no duplicates). */
  function reporterNames(r) {
    const out = []; for (const s of r.specs) { const n = s.data && s.data.user && s.data.user.username; if (n && !out.includes(n)) out.push(n); if (out.length >= 3) break; }
    return out;
  }
  /** Ceremony data for a fixture, or null. League: only the FIRST announced fixture while no league match has been played (the cup opening, long).
   *  Semi-finals and the final get a short version (title, pairing, fair play, next match). */
  async function openingCeremony(r) {
    if (!r.fixture || !['league', 'semi', 'final'].includes(r.fixture.stage)) return null;
    let cup; try { cup = await core.penCup(null); } catch (_) { return null; }
    if (!cup || !cup.league.started) return null;
    const base = { cup: 'AUREX PENALTY CUP', year: new Date(now()).getFullYear(), teamCount: cup.league.teamCount, serverNow: now(),
      standings: cup.standings.map(x => ({ rank: x.rank, team: liveTeam({ id: x.teamId, name: x.name, hasLogo: x.hasLogo }), played: x.played, points: x.points, gd: x.gd })) };
    const nextOf = f => f ? { teamA: liveTeam(f.teamA), teamB: liveTeam(f.teamB), scheduledAt: f.scheduledAt || null } : null;
    if (r.fixture.stage === 'league') {
      if (cup.progress.leaguePlayed > 0) return null;
      const lf = cup.fixtures.filter(f => f.stage === 'league');
      if (!lf.length || lf[0].id !== r.fixture.id) return null;
      return { ...base, opening: true, kind: 'league', preMs: T.openingExtraMs, matchNo: 1, matchTotal: cup.progress.leagueTotal, next: nextOf(lf.find(f => f.id !== r.fixture.id && !f.played)) };
    }
    const same = cup.fixtures.filter(f => f.stage === r.fixture.stage && f.id !== r.fixture.id && !f.played);
    return { ...base, opening: false, kind: r.fixture.stage, preMs: T.finalExtraMs, next: r.fixture.stage === 'semi' ? nextOf(same[0]) : null };
  }
  /** Tell everybody in the room who the reporters are (only while the ceremony is on screen). */
  function ceremonyReporters(r) { if (r.ceremony && r.phase === 'intro') emit(r, 'ceremony:reporters', { reporters: reporterNames(r) }); }
  /* ---------------------------------------------------------------- match flow */
  async function startMatch(r) {
    if (r.phase !== 'lobby' || !r.players[0] || !r.players[1]) return;
    r.phase = 'starting';
    if (r.fixture) {                                             // an announced league match: only while its fixture is still unplayed
      let f = null; try { f = await store.getPenFixture(r.fixture.id); } catch (_) { f = null; }
      if (!f || f.matchId) { r.phase = 'lobby'; r.players.forEach(sd => { if (sd) sd.members.forEach(m => { m.ready = false; }); }); emit(r, 'err', { code: 'MATCH_PLAYED', message: 'This league match has already been decided.' }); lobbyUpdate(r); return; }
    }
    const cer = await openingCeremony(r).catch(() => null);      // only the very first league match of the cup
    if (r.phase !== 'starting') return;
    r.league = r.stage === 'league';                             // only the round robin counts in the table; friendlies never do
    const first = rng() < 0.5 ? 0 : 1; r.sh = Rules.newShootout(first); r.phase = 'intro'; r.k = 0;
    const introMs = T.introMs + (cer ? cer.preMs : 0); r.ceremony = cer ? { ...cer, introMs } : null; r.introAt = now(); r.introMs = introMs;
    if (r.ceremony) r.ceremony.reporters = reporterNames(r);
    emit(r, 'match:start', { matchId: r.id, league: r.stage !== 'friendly', stage: r.stage, first, players: r.players.map(pub), introMs, room: roomView(r), ...(r.ceremony ? { ceremony: r.ceremony } : {}) });
    r.t.intro = setTimeout(() => nextKick(r), introMs);
    hostToReporter(r);                                           // the owner who started the match now watches it like a reporter (گزارشگر)
  }

  /** 2-player teams: the members of a team take turns. Kick n of a side is taken by member (n mod size); the keeper of the other side rotates the same way.
   *  A member who is offline is skipped (his teammate covers); a solo team plays every role itself. A retake keeps the same two people. */
  function pickActors(r, side) {
    const att = r.players[side], def = r.players[1 - side], n = r.sh.kicks[side];
    const pick = (sd, idx) => { for (let k = 0; k < sd.members.length; k++) { const m = sd.members[(idx + k) % sd.members.length]; if (m.on) return m; } return null; };
    const shooter = pick(att, n), keeper = pick(def, n);
    return shooter && keeper ? { shooter, keeper } : null;
  }
  function nextKick(r, retakes = 0) {
    if (r.ended) return;
    clearTimeout(r.t.intro); clearTimeout(r.t.next);
    const side = Rules.shooterOf(r.sh), keeper = 1 - side, nowMs = now(), who = pickActors(r, side);
    if (!who) { r.waiting = true; r.waitRetakes = retakes; r.phase = 'waiting'; emit(r, 'room', { room: roomView(r) }); return; }
    r.waiting = false;
    r.k++;
    r.turn = { k: r.k, side, keeper, shooterUser: who.shooter.userId, keeperUser: who.keeper.userId, retakes, whistleAt: nowMs + T.whistleMs, deadline: nowMs + T.whistleMs + T.aimMs, input: null, runAt: 0, strikeAt: 0, feint: null, dive: null, sim: null, sentIdx: 0, sentEv: 0, done: false, kzAtStrike: 0, kpAtStrike: null, diveDeadline: 0 };
    for (const p of r.players) { p.kp = { x: 0, kz: 0 }; p.inp = { mx: 0, mz: 0 }; }
    r.phase = 'aim';
    emit(r, 'turn', { k: r.k, shooter: side, keeper, shooterUser: who.shooter.userId, keeperUser: who.keeper.userId, shooterName: who.shooter.username, keeperName: who.keeper.username, retake: retakes, round: Rules.roundOf(r.sh, side), whistleAt: r.turn.whistleAt, deadline: r.turn.deadline, ...scoreView(r), cards: r.players.map(p => p.yellow) });
    r.t.tick = setInterval(() => tickKeeper(r), T.tickMs);
    r.t.aim = setTimeout(() => aimTimeout(r), T.whistleMs + T.aimMs);
  }

  function tickKeeper(r) {
    if (!r.turn || (r.phase !== 'aim' && r.phase !== 'runup')) return;
    const p = r.players[r.turn.keeper]; if (!p || r.turn.dive) return;
    const dt = T.tickMs / 1000, nx = clamp(p.kp.x + p.inp.mx * 3.2 * dt, -C.KEEPER_MAX_X, C.KEEPER_MAX_X), nz = clamp(p.kp.kz + p.inp.mz * 1.4 * dt, 0, C.KEEPER_MAX_Z);
    if (nx !== p.kp.x || nz !== p.kp.kz) { p.kp = { x: +nx.toFixed(3), kz: +nz.toFixed(3) }; emit(r, 'kp', { x: p.kp.x, kz: p.kp.kz }); }
  }

  function aimTimeout(r) {            // shooter never shot: the kick is lost (no stalling the duel)
    if (r.phase !== 'aim' || !r.turn) return;
    clearInterval(r.t.tick);
    conclude(r, { final: 'miss', retake: false, cards: [], call: null, var: null, timeout: true, measures: {} }, null);
  }

  function onShoot(r, uid, d) {
    const t = r.turn; if (!t || r.phase !== 'aim' || uid !== t.shooterUser || now() < t.whistleAt) return;
    t.input = { ax: clamp(num(d.ax), -1.4, 1.4), ay: clamp(num(d.ay), 0, 1.45), pw: clamp(num(d.pw, 0.5), 0.2, 1), curve: clamp(num(d.curve), -1, 1) };
    clearTimeout(r.t.aim); r.phase = 'runup'; t.runAt = now(); t.strikeAt = t.runAt + RUN;
    emit(r, 'runup', { k: t.k, runAt: t.runAt, strikeAt: t.strikeAt, runMs: RUN });
    r.t.strike = setTimeout(() => strike(r), RUN);
  }
  function onFeint(r, uid) {
    const t = r.turn; if (!t || r.phase !== 'runup' || uid !== t.shooterUser || t.feint) return;
    const progress = (now() - t.runAt) / RUN; if (progress < 0.05 || progress >= 1) return;
    t.feint = { progress: +progress.toFixed(3) }; t.strikeAt += FDELAY;
    clearTimeout(r.t.strike); r.t.strike = setTimeout(() => strike(r), Math.max(0, t.strikeAt - now()));
    emit(r, 'feint', { k: t.k, progress: t.feint.progress, strikeAt: t.strikeAt });
  }
  function onDive(r, uid, d) {
    const t = r.turn; if (!t || uid !== t.keeperUser || t.dive || (r.phase !== 'runup' && r.phase !== 'flight')) return;
    const dir = clamp(Math.round(num(d.dir)), -1, 1), hi = !!d.hi; if (dir === 0 && !hi) return;
    if (r.phase === 'flight' && now() > t.diveDeadline) return;
    const p = r.players[t.keeper];
    t.dive = { dir, hi, tdMs: now(), x: p.kp.x, kz: p.kp.kz };
    emit(r, 'dive', { k: t.k, dir, hi, tdMs: t.dive.tdMs, x: p.kp.x, kz: p.kp.kz });
    if (r.phase === 'flight') resim(r);
  }

  /* simulate the current kick with the keeper's dive (if any) */
  function simulateTurn(r) {
    const t = r.turn;
    const kp = t.dive ? { x: t.dive.x, kz: t.dive.kz } : t.kpAtStrike;
    const dive = t.dive ? { dir: t.dive.dir, hi: t.dive.hi, at: (t.dive.tdMs - t.strikeAt) / 1000 * S } : null;
    return P.simulate({ vel: t.launch.vel, curve: t.launch.curve, keeper: { x: kp.x, kz: kp.kz, dive } });
  }
  function strike(r) {
    const t = r.turn; if (!t || r.phase !== 'runup') return;
    const kpl = r.players[t.keeper].kp; t.kpAtStrike = t.dive ? { x: t.dive.x, kz: t.dive.kz } : { x: kpl.x, kz: kpl.kz }; t.kzAtStrike = t.kpAtStrike.kz;
    clearInterval(r.t.tick);
    t.launch = P.launch(t.input, rng); t.sim = simulateTurn(r);
    r.phase = 'flight';
    const cross = t.sim.crossing ? t.sim.crossing.t : (t.sim.keeperTouch ? t.sim.keeperTouch.t : 0.9);
    t.diveDeadline = t.strikeAt + Math.min(1200, Math.max(250, cross * 1000 - 60)) / S;
    emit(r, 'kick', { k: t.k, strikeAt: t.strikeAt, curve: t.launch.curve, speed: +t.launch.speed.toFixed(1), keeper: t.kpAtStrike, lookMs: T.lookMs });
    streamTick(r);
    r.t.stream = setInterval(() => streamTick(r), T.streamMs);
    r.t.final = setTimeout(() => finalizeKick(r), Math.max(0, t.diveDeadline - now()) + 40);
  }
  function resim(r) {
    const t = r.turn, old = t.sim; t.sim = simulateTurn(r);
    let d = 0; const n = Math.min(old.samples.length, t.sim.samples.length);
    while (d < n && old.samples[d][1] === t.sim.samples[d][1] && old.samples[d][2] === t.sim.samples[d][2] && old.samples[d][3] === t.sim.samples[d][3]) d++;
    if (t.sentIdx > d) { t.sentIdx = d; emit(r, 'ball', { k: t.k, from: d, pts: [], replace: true }); }
    t.sentEv = Math.min(t.sentEv, t.sim.events.filter(e => e.t * 1000 + t.strikeAt <= now()).length);
    streamTick(r);
  }
  function streamTick(r) {
    const t = r.turn; if (!t || !t.sim) return;
    const lim = (now() - t.strikeAt) * S + T.lookMs, s = t.sim.samples, pts = [];
    while (t.sentIdx < s.length && s[t.sentIdx][0] * 1000 <= lim) pts.push(s[t.sentIdx++]);
    const ev = []; while (t.sentEv < t.sim.events.length && t.sim.events[t.sentEv].t * 1000 <= lim) ev.push(t.sim.events[t.sentEv++]);
    if (pts.length || ev.length) emit(r, 'ball', { k: t.k, from: t.sentIdx - pts.length, pts, ev });
  }
  function finalizeKick(r) {
    const t = r.turn; if (!t || r.phase !== 'flight' || t.done) return;
    t.done = true; t.sim = simulateTurn(r);
    const decision = judge({ sim: t.sim, kz: t.kzAtStrike, feintProgress: t.feint ? t.feint.progress : null, keeperYellows: (memberOf(r, t.keeperUser) || {}).yellow || 0, retakes: t.retakes });
    const s = t.sim, cross = s.crossing ? s.crossing.t : null;
    const revealMs = Math.min(s.endT, cross != null ? cross + 0.45 : s.keeperTouch ? s.keeperTouch.t + 0.9 : s.endT) * 1000;
    r.phase = 'reveal';
    r.t.reveal = setTimeout(() => { clearInterval(r.t.stream); streamTick(r); conclude(r, decision, s); }, Math.max(0, t.strikeAt + revealMs / S - now()));
  }

  /* VAR (only for suspicious kicks) -> result -> next kick */
  function conclude(r, d, sim) {
    const t = r.turn; if (!t || r.ended) return;
    clearTimeout(r.t.aim); clearInterval(r.t.stream); clearInterval(r.t.tick);
    const finish = () => {
      for (const c of d.cards) { const idx = c.who === 'shooter' ? t.side : t.keeper, m = memberOf(r, c.who === 'shooter' ? t.shooterUser : t.keeperUser); if (m) m.yellow = (m.yellow || 0) + 1; r.players[idx].yellow++; }   // cautions belong to the PERSON, the team total is shown
      const base = { k: t.k, shooter: t.side, keeper: t.keeper, shooterUser: t.shooterUser, keeperUser: t.keeperUser, shooterName: (memberOf(r, t.shooterUser) || {}).username, keeperName: (memberOf(r, t.keeperUser) || {}).username, outcome: sim ? sim.outcome : 'miss', timeout: !!d.timeout, retake: !!d.retake, awardedGoal: !!d.awardedGoal, cards: d.cards, call: d.call, var: d.var ? { reasons: d.var.reasons, verdict: d.var.verdict } : null, measures: d.measures, cardsTotal: r.players.map(p => p.yellow) };
      if (d.retake) {
        r.phase = 'result'; emit(r, 'result', { ...base, final: 'retake', ...scoreView(r), over: false });
        r.t.next = setTimeout(() => nextKick(r, t.retakes + 1), T.retakeMs + (d.var ? T.varExtraMs : 0)); return;
      }
      const entry = { res: d.final, var: !!d.var, card: d.cards.length ? d.cards.map(c => c.who[0]).join('') : null };
      const dec = Rules.applyKick(r.sh, t.side, entry);
      if (d.var) { r.varCount++; r.vars.push({ k: t.k, reasons: d.var.reasons, verdict: d.var.verdict.code }); }
      r.phase = 'result';
      emit(r, 'result', { ...base, final: d.final, ...scoreView(r), over: dec.over, winner: dec.winner, endReason: dec.reason });
      if (dec.over) r.t.next = setTimeout(() => finishMatch(r, dec.winner, dec.reason), T.resultMs);
      else r.t.next = setTimeout(() => nextKick(r), T.resultMs + (d.var ? T.varExtraMs : 0));
    };
    if (d.var) {
      r.phase = 'var';
      emit(r, 'var:start', { k: t.k, reasons: d.var.reasons, steps: d.var.steps, ms: d.var.ms, measures: d.measures });
      r.t.var = setTimeout(finish, d.var.ms + 300);
    } else finish();
  }

  /* ---------------------------------------------------------------- end of match + persistence */
  async function finishMatch(r, winner, reason, forfeit = false) {
    if (r.ended) return; r.ended = true; r.phase = 'end'; clearTimers(r);
    const a = r.sh ? r.sh.goals : [0, 0];
    const table = forfeit ? (winner === 0 ? [3, 0] : [0, 3]) : [a[0], a[1]];
    const result = Rules.outcomeOf(winner);
    const rec = { id: r.id, teamA: r.players[0].team.id, teamB: r.players[1].team.id, playerA: r.players[0].members[0].userId, playerB: r.players[1].members[0].userId, goalsA: table[0], goalsB: table[1],
      kicksA: r.sh ? r.sh.kicks[0] : 0, kicksB: r.sh ? r.sh.kicks[1] : 0, result, reason: forfeit ? 'forfeit' : reason, league: r.league, stage: r.stage, fixtureId: r.fixture ? r.fixture.id : null, winnerTeam: winner == null ? null : r.players[winner].team.id, varCount: r.varCount,
      detail: { members: r.players.map(sd => sd.members.map(m => m.username)), first: r.sh && r.sh.first, log: r.sh && r.sh.log, cards: r.players.map(p => p.yellow), vars: r.vars, actual: a } };
    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) { try { saved = (await store.recordPenMatch(rec)).kind === 'OK'; if (!saved) break; } catch (e) { console.error('[aurex-pen] could not store result:', e.message); await new Promise(res => setTimeout(res, 400)); } }
    r.saved = saved;
    emit(r, 'end', { matchId: r.id, winner, result, reason: rec.reason, league: r.stage !== 'friendly', stage: r.stage, table, actual: a, saved, ...(r.sh ? scoreView(r) : {}), players: r.players.map(pub), varCount: r.varCount, cards: r.players.map(p => p.yellow) });
    if (saved && r.fixture) { try { await core.penAdvance(); } catch (e) { console.error('[aurex-pen] league advance failed:', e.message); } }   // round robin done -> play-offs / final / champion
    for (const sd of r.players) if (sd) for (const m of sd.members) if (userRoom.get(m.userId) === r) userRoom.delete(m.userId);
    r.t.cleanup = setTimeout(() => destroy(r), T.cleanupMs);
  }
  const sideOn = sd => sd.members.some(m => m.on);
  function startForfeitTimer(r, i) {                  // only when EVERY member of a team is gone
    const sd = r.players[i]; clearTimeout(sd.dt);
    sd.dt = setTimeout(() => {
      if (sideOn(sd) || r.ended || !r.sh) return;
      if (r.players.every(x => !sideOn(x))) { r.ended = true; destroy(r); return; }     // both teams gone: nobody wins, nothing is recorded
      finishMatch(r, 1 - i, 'forfeit', true);
    }, T.reconnectMs);
  }

  /* ---------------------------------------------------------------- reporter (read-only spectators) */
  const SPEC_MAX = 300, LIVE_PHASES = ['intro', 'waiting', 'aim', 'runup', 'flight', 'reveal', 'var', 'result'];
  const isLive = r => !!r.sh && !r.ended && LIVE_PHASES.includes(r.phase);
  const liveInfo = r => ({ code: r.code, stage: r.stage, league: r.stage !== 'friendly', phase: r.phase, watchers: r.specs.size, goals: [...r.sh.goals], kicks: [...r.sh.kicks],
    sides: r.players.map(sd => ({ team: { id: sd.team.id, name: sd.team.name, hasLogo: !!sd.team.hasLogo, club: sd.team.club ? { id: sd.team.club.id, short: sd.team.club.short, colors: sd.team.club.colors } : null }, players: sd.members.map(m => m.username) })) });
  /** What a spectator needs to join in the middle of a match: the same facts the players' own events carry (turn / kick / ball), nothing private. */
  function specSnapshot(r) {
    const t = r.turn, nm = id => (memberOf(r, id) || {}).username;
    const out = { code: r.code, matchId: r.id, phase: r.phase, league: r.stage !== 'friendly', stage: r.stage, players: r.players.map(pub), ...scoreView(r), cards: r.players.map(p => p.yellow), watchers: r.specs.size, ts: now() };
    if (r.phase === 'intro' && r.ceremony) { out.ceremony = { ...r.ceremony, reporters: reporterNames(r) }; out.introMs = r.introMs; out.introLeftMs = Math.max(0, r.introAt + r.introMs - now()); }
    if (t && r.phase !== 'intro') {
      out.turn = { k: t.k, shooter: t.side, keeper: t.keeper, shooterUser: t.shooterUser, keeperUser: t.keeperUser, shooterName: nm(t.shooterUser), keeperName: nm(t.keeperUser), retake: t.retakes, whistleAt: t.whistleAt, deadline: t.deadline, strikeAt: t.strikeAt, runAt: t.runAt, runMs: RUN, keeperPos: r.players[t.keeper].kp, dive: t.dive, feint: t.feint };
      if (t.launch && t.sim && t.kpAtStrike) { out.kick = { k: t.k, strikeAt: t.strikeAt, curve: t.launch.curve, speed: +t.launch.speed.toFixed(1), keeper: t.kpAtStrike, lookMs: T.lookMs }; out.ball = t.sim.samples.slice(0, t.sentIdx); }
    }
    return out;
  }
  function specStop(sock) {
    const code = sock.data && sock.data.spec; if (!code) return;
    sock.data.spec = null; try { sock.leave(code); } catch (_) { }
    const r = rooms.get(code); if (r) { r.specs.delete(sock); ceremonyReporters(r); }
  }

  /* ---------------------------------------------------------------- owner = host of a league match */
  /** The owner who is waiting in the lobby of a league room is moved into the stand: from now on he is an ordinary reporter of this match (names show in the ceremony). */
  function hostToReporter(r) {
    const h = r.host; if (!h) return; r.host = null;
    const sk = h.socket; sk.data.host = null; try { sk.leave(hostKey(r)); } catch (_) { }
    if (sk.data.spec && sk.data.spec !== r.code) specStop(sk);
    sk.join(r.code); r.specs.add(sk); sk.data.spec = r.code;
    sk.emit('spec:start', specSnapshot(r)); ceremonyReporters(r);
  }
  function hostLeave(sock) {
    const code = sock.data && sock.data.host; if (!code) return;
    sock.data.host = null; try { sock.leave(code + ':host'); } catch (_) { }
    const r = rooms.get(code); if (!r || !r.host || r.host.socket !== sock) return;
    r.host = null;
    if (r.phase === 'lobby') { if (!r.players[0] && !r.players[1]) destroy(r); else lobbyUpdate(r); }
  }
  function hostHandlers(socket, wrap) {
    const u = socket.data.user, fail = (c, message) => socket.emit('host:error', { code: c, message });
    socket.on('host:join', wrap(async d => {
      if (u.role !== 'OWNER') return fail('FORBIDDEN', 'Only the owner can host a league match.');
      const code = String(d && d.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      if (!Rules.isFixtureCode(code)) return fail('NOT_A_LEAGUE_ROOM', 'This is not the room code of an announced league match.');
      let f = null; try { f = await store.getPenFixtureByCode(code); } catch (_) { f = null; }
      if (!f) return fail('ROOM_NOT_FOUND', 'Room not found.');
      if (f.matchId) return fail('MATCH_PLAYED', 'This league match has already been played.');
      const team = socket.data.team; if (team && (team.id === f.teamA || team.id === f.teamB)) return fail('OWNER_IS_PLAYER', 'Your own team plays in this match, so you cannot host it.');
      let r = rooms.get(code);
      if (r && isLive(r)) { socket.emit('host:watch', { code }); return; }       // already running: just watch it
      if (r && r.phase !== 'lobby') return fail('ROOM_BUSY', 'This match has already started.');
      if (r && r.host && r.host.userId !== u.id) return fail('HOST_TAKEN', 'Another owner is already hosting this match.');
      if (socket.data.host && socket.data.host !== code) hostLeave(socket);
      if (socket.data.spec) specStop(socket);
      if (!r) r = makeRoom(f);
      if (r.host && r.host.socket !== socket) { const old = r.host.socket; old.data.host = null; try { old.leave(hostKey(r)); } catch (_) { } old.emit('host:end', { code, replaced: true }); }
      r.host = { userId: u.id, username: u.username, socket }; socket.data.host = code; socket.join(hostKey(r));
      socket.emit('host:joined', { code, room: roomView(r), ts: now() }); lobbyUpdate(r);
    }));
    socket.on('host:start', wrap(() => {
      const code = socket.data.host, r = code && rooms.get(code);
      if (!r || !r.host || r.host.socket !== socket) return fail('NOT_HOSTING', 'You are not hosting a room.');
      if (r.phase !== 'lobby') return;
      if (!sidesReady(r)) return fail('NOT_READY', 'Both teams must be in the room and every player must press Ready first.');
      startMatch(r).catch(e => console.error('[aurex-pen] start failed:', e));
    }));
    socket.on('host:leave', wrap(() => hostLeave(socket)));
  }
  /** A reporter socket (client connects with ?mode=reporter): it never takes the player's seat, never replaces his game tab and has NO game handlers at all. */
  function reporterConnection(socket) {
    const u = socket.data.user, wrap = fn => (...a) => { try { fn(...a); } catch (e) { console.error('[aurex-pen] reporter handler error:', e); } };
    let lastList = 0, lastWatch = 0;
    socket.emit('hello', { user: u, spectator: true, ts: now() });
    socket.on('ping:t', wrap(cb => { if (typeof cb === 'function') cb(now()); }));
    socket.on('spec:list', wrap(() => { const tn = now(); if (tn - lastList < 700) return; lastList = tn; socket.emit('spec:list', { list: [...rooms.values()].filter(isLive).map(liveInfo), ts: tn }); }));
    socket.on('spec:watch', wrap(d => {
      const tn = now(); if (tn - lastWatch < 300) return; lastWatch = tn;
      const code = String(d && d.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5), r = rooms.get(code);
      if (!r || !isLive(r)) return socket.emit('spec:error', { code: 'MATCH_NOT_LIVE', message: 'This match is not running (any more).' });
      if (socket.data.spec === code) return;
      if (r.specs.size >= SPEC_MAX) return socket.emit('spec:error', { code: 'FULL', message: 'Too many reporters are watching this match.' });
      specStop(socket); socket.join(code); r.specs.add(socket); socket.data.spec = code;
      socket.emit('spec:start', specSnapshot(r)); ceremonyReporters(r);
    }));
    socket.on('spec:leave', wrap(() => specStop(socket)));
    if (u.role === 'OWNER') hostHandlers(socket, wrap);     // only the OWNER can host a league room; nobody else gets these handlers
    socket.on('disconnect', wrap(() => { hostLeave(socket); specStop(socket); }));
  }

  /* ---------------------------------------------------------------- sockets */
  nsp.on('connection', socket => {
    if (socket.handshake && socket.handshake.query && socket.handshake.query.mode === 'reporter') return reporterConnection(socket);
    const u = socket.data.user, old = userSocket.get(u.id);
    if (old && old !== socket) { old.emit('err', { code: 'OPENED_ELSEWHERE', message: 'AUREX was opened in another tab or device.' }); old.data.replaced = true; old.disconnect(true); }
    userSocket.set(u.id, socket);
    const wrap = fn => (...a) => { try { fn(...a); } catch (e) { console.error('[aurex-pen] handler error:', e); } };
    const room = () => userRoom.get(u.id);

    // reconnect into a running match
    const r0 = room();
    if (r0) {
      const i = idxOf(r0, u.id), sd0 = r0.players[i], mem = sd0.members.find(m => m.userId === u.id); mem.on = true; clearTimeout(sd0.dt); socket.join(r0.code);
      socket.emit('joined', { you: i, uid: u.id, code: r0.code, room: roomView(r0), ts: now(), resumed: true });
      if (r0.sh && r0.phase !== 'lobby') {
        const t = r0.turn;
        socket.emit('sync', { you: i, uid: u.id, room: roomView(r0), phase: r0.phase, matchId: r0.id, league: r0.stage !== 'friendly', stage: r0.stage, ...(r0.sh ? scoreView(r0) : {}), cards: r0.players.map(q => q.yellow),
          turn: t ? { k: t.k, shooter: t.side, keeper: t.keeper, shooterUser: t.shooterUser, keeperUser: t.keeperUser, retake: t.retakes, whistleAt: t.whistleAt, deadline: t.deadline, strikeAt: t.strikeAt, runAt: t.runAt, keeperPos: r0.players[t.keeper].kp, dive: t.dive, feint: t.feint } : null, ts: now() });
      }
      emit(r0, 'room', { room: roomView(r0) });
      if (r0.waiting && r0.players.every(sideOn)) nextKick(r0, r0.waitRetakes || 0);
    } else socket.emit('hello', { user: u, team: socket.data.team, error: socket.data.teamError, ts: now() });

    socket.on('ping:t', wrap(cb => { if (typeof cb === 'function') cb(now()); }));
    socket.on('quick', wrap(() => { if (room() || !checkEligible(socket)) return; tryQuick(socket); }));
    socket.on('create', wrap(() => {
      if (room() || !checkEligible(socket)) return;
      const r = makeRoom(); const i = seat(r, socket); socket.emit('joined', { you: i, uid: u.id, code: r.code, room: roomView(r), ts: now() }); lobbyUpdate(r);
    }));
    /** Room of an announced league match: only the two teams, only from the announced time, only until the match has a result. */
    async function joinFixture(code) {
      const fail = (c, message, extra) => socket.emit('err', { code: c, message, ...(extra || {}) });
      let f = null; try { f = await store.getPenFixtureByCode(code); } catch (_) { f = null; }
      if (!f) return fail('ROOM_NOT_FOUND', 'Room not found or already started.');
      if (f.matchId) return fail('MATCH_PLAYED', 'This league match has already been played.');
      const team = socket.data.team; if (!team || (team.id !== f.teamA && team.id !== f.teamB)) return fail('NOT_YOUR_MATCH', 'This room belongs to a league match of two other teams.');
      if (!f.scheduledAt) return fail('MATCH_NOT_SCHEDULED', 'The owner has not announced the time of this match yet.');
      const opensAt = +new Date(f.scheduledAt); if (now() < opensAt) return fail('MATCH_NOT_OPEN', 'This room opens on ' + new Date(opensAt).toUTCString().replace(' GMT', ' UTC') + '.', { opensAt: f.scheduledAt });
      if (room()) return;                                                  // joined somewhere else while we were checking
      let r = rooms.get(code);
      if (r && r.phase !== 'lobby') return fail('ROOM_FULL', 'This match has already started.');
      if (!r) r = makeRoom(f);
      const i = seat(r, socket); if (i < 0) { if (!r.players[0] && !r.players[1] && !r.host) destroy(r); return fail('ROOM_FULL', 'This room is full (or your team already has 2 players in it).'); }
      r.players.forEach(sd => { if (sd) sd.members.forEach(m => { m.ready = false; }); });
      socket.emit('joined', { you: i, uid: u.id, code: r.code, room: roomView(r), ts: now() }); lobbyUpdate(r);
    }
    socket.on('join', wrap(d => {
      if (room() || !checkEligible(socket)) return;
      const code = String(d && d.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
      if (Rules.isFixtureCode(code)) { joinFixture(code).catch(e => console.error('[aurex-pen] fixture join failed:', e.message)); return; }
      const r = rooms.get(code);
      if (!r || r.phase !== 'lobby') return socket.emit('err', { code: 'ROOM_NOT_FOUND', message: 'Room not found or already started.' });
      const i = seat(r, socket);      // joins his own team's side as the 2nd member (only registered members of that team can), or the free opposing side
      if (i < 0) return socket.emit('err', { code: 'ROOM_FULL', message: 'This room is full (or your team already has 2 players in it).' });
      r.players.forEach(sd => { if (sd) sd.members.forEach(m => { m.ready = false; }); });
      socket.emit('joined', { you: i, uid: u.id, code: r.code, room: roomView(r), ts: now() }); lobbyUpdate(r);
    }));
    socket.on('leave', wrap(() => leaveLobby(socket)));
    socket.on('ready', wrap(() => {
      const r = room(); if (!r || r.phase !== 'lobby' || !r.players[0] || !r.players[1]) return;
      memberOf(r, u.id).ready = true; lobbyUpdate(r);
      if (!r.players.every(sd => sd.members.every(m => m.ready))) return;
      if (needsHost(r)) { lobbyUpdate(r); return; }         // league match: both teams are ready, now the OWNER presses START
      startMatch(r).catch(e => console.error('[aurex-pen] start failed:', e));
    }));
    socket.on('shoot', wrap(d => { const r = room(); if (r) onShoot(r, u.id, d || {}); }));
    socket.on('feint', wrap(() => { const r = room(); if (r) onFeint(r, u.id); }));
    socket.on('kin', wrap(d => {
      const r = room(); if (!r || !r.turn || r.turn.keeperUser !== u.id) return;
      const p = r.players[r.turn.keeper], tn = now(); if (p.lastKin && tn - p.lastKin < 15) return; p.lastKin = tn;   // flood guard
      p.inp = { mx: sgn(num(d && d.mx)), mz: sgn(num(d && d.mz)) };
    }));
    socket.on('dive', wrap(d => { const r = room(); if (r) onDive(r, u.id, d || {}); }));
    socket.on('disconnect', wrap(() => {
      if (userSocket.get(u.id) === socket) userSocket.delete(u.id);
      queue = queue.filter(q => q.userId !== u.id);
      if (socket.data.replaced) return;
      const r = room(); if (!r) return;
      const i = idxOf(r, u.id), mem = memberOf(r, u.id); if (!mem) return;
      mem.on = false;
      if (r.phase === 'lobby') { leaveLobby(socket); return; }
      if (r.ended) return;
      emit(r, 'room', { room: roomView(r) });
      if (r.sh) { if (!sideOn(r.players[i])) startForfeitTimer(r, i); }       // a teammate still online keeps the team in the match
      else { r.phase = 'lobby'; leaveLobby(socket); }
    }));
  });

  return { rooms, userRoom, nsp, _queue: () => queue, _live: () => [...rooms.values()].filter(isLive).map(liveInfo) };
}

module.exports = { attach, DEFAULT_TIMING };
