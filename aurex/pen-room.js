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

const DEFAULT_TIMING = { aimMs: 25000, introMs: 10000, whistleMs: 1600, resultMs: 3600, varExtraMs: 1200, retakeMs: 2600, reconnectMs: 60000, queueMs: 180000, tickMs: 40, streamMs: 50, lookMs: 160, cleanupMs: 90000 };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sgn = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

function attach(io, { store, api }, opts = {}) {
  const core = api.core, T = { ...DEFAULT_TIMING, ...(opts.timing || {}) };
  const RUN = T.runupMs || C.RUNUP_MS, FDELAY = T.feintDelayMs || C.FEINT_DELAY_MS, S = opts.timeScale || 1;   // S > 1 only in tests (faster than real time)
  const rng = opts.rng || Math.random, now = opts.now || Date.now;
  const nsp = io.of('/aurex-pen');
  const rooms = new Map();            // code -> room
  const userRoom = new Map();         // userId -> room
  const userSocket = new Map();       // userId -> socket
  let queue = [];                     // [{ userId, at }]

  /* ---------------------------------------------------------------- helpers */
  const newCode = () => { let c; do { c = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)]).join(''); } while (rooms.has(c)); return c; };
  const emit = (r, ev, data) => nsp.to(r.code).emit(ev, { ...data, ts: now() });
  const toSock = (p, ev, data) => { const s = p && userSocket.get(p.userId); if (s) s.emit(ev, { ...data, ts: now() }); };
  const pub = p => p ? { userId: p.userId, username: p.username, on: p.on, ready: p.ready, team: p.team, yellow: p.yellow } : null;
  const clearTimers = r => { for (const k of Object.keys(r.t)) { clearTimeout(r.t[k]); clearInterval(r.t[k]); } r.t = {}; };
  const scoreView = r => r.sh ? { kicks: [...r.sh.kicks], goals: [...r.sh.goals], log: r.sh.log.map(l => l.map(e => ({ ...e }))), first: r.sh.first } : null;
  const roomView = r => ({ code: r.code, phase: r.phase, league: r.league, players: r.players.map(pub), ...(r.sh ? scoreView(r) : {}) });

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
      socket.data = { user: { id: s.user.id, username: s.user.username }, team: info.team || null, teamError: info.error || null };
      next();
    } catch (e) { next(new Error('AUTH_FAILED')); }
  });

  /* ---------------------------------------------------------------- rooms */
  function makeRoom() {
    const r = { code: newCode(), id: crypto.randomUUID(), phase: 'lobby', players: [null, null], league: false, sh: null, t: {}, turn: null, waiting: false, saved: false, varCount: 0, vars: [], createdAt: now(), ended: false };
    rooms.set(r.code, r); return r;
  }
  function seat(r, sock) {
    const u = sock.data.user, i = r.players[0] ? 1 : 0;
    r.players[i] = { userId: u.id, username: u.username, team: sock.data.team, on: true, ready: false, yellow: 0, kp: { x: 0, kz: 0 }, inp: { mx: 0, mz: 0 }, dt: null };
    userRoom.set(u.id, r); sock.join(r.code); queue = queue.filter(q => q.userId !== u.id);
    return i;
  }
  const idxOf = (r, userId) => r.players.findIndex(p => p && p.userId === userId);
  function destroy(r) { clearTimers(r); for (const p of r.players) if (p && userRoom.get(p.userId) === r) userRoom.delete(p.userId); rooms.delete(r.code); }
  function lobbyUpdate(r) { emit(r, 'lobby', { room: roomView(r) }); }

  function checkEligible(sock) {
    if (sock.data.teamError) { sock.emit('err', { code: 'TEAM_NOT_ACTIVE', message: sock.data.teamError }); return false; }
    return true;
  }
  function leaveLobby(sock) {
    const r = userRoom.get(sock.data.user.id);
    queue = queue.filter(q => q.userId !== sock.data.user.id);
    if (!r || r.phase !== 'lobby') return;
    const i = idxOf(r, sock.data.user.id); sock.leave(r.code); userRoom.delete(sock.data.user.id);
    r.players[i] = null; if (r.players[0] === null && r.players[1]) { r.players[0] = r.players[1]; r.players[1] = null; }
    if (!r.players[0]) destroy(r); else { r.players.forEach(p => { if (p) p.ready = false; }); lobbyUpdate(r); }
  }
  function tryQuick(sock) {
    const me = sock.data.user.id;
    const cand = queue.find(q => q.userId !== me && userSocket.get(q.userId) && userSocket.get(q.userId).data.team && userSocket.get(q.userId).data.team.id !== sock.data.team.id && now() - q.at < T.queueMs);
    if (!cand) { queue = queue.filter(q => q.userId !== me); queue.push({ userId: me, at: now() }); sock.emit('queue', { waiting: true }); return; }
    const other = userSocket.get(cand.userId); queue = queue.filter(q => q.userId !== cand.userId && q.userId !== me);
    const r = makeRoom(); seat(r, other); seat(r, sock);
    other.emit('joined', { you: 0, code: r.code, room: roomView(r), ts: now() }); sock.emit('joined', { you: 1, code: r.code, room: roomView(r), ts: now() }); lobbyUpdate(r);
  }

  /* ---------------------------------------------------------------- match flow */
  async function startMatch(r) {
    if (r.phase !== 'lobby' || !r.players[0] || !r.players[1]) return;
    r.phase = 'starting';
    let league = false; try { league = (await store.getPenLeague()).started; } catch (_) { /* a failed read counts as friendly: never a wrong table entry */ }
    if (r.phase !== 'starting') return;
    r.league = !!league;                                         // decided ONCE, when the match starts
    const first = rng() < 0.5 ? 0 : 1; r.sh = Rules.newShootout(first); r.phase = 'intro'; r.k = 0;
    emit(r, 'match:start', { matchId: r.id, league: r.league, first, players: r.players.map(pub), introMs: T.introMs, room: roomView(r) });
    r.t.intro = setTimeout(() => nextKick(r), T.introMs);
  }

  function nextKick(r, retakes = 0) {
    if (r.ended) return;
    clearTimeout(r.t.intro); clearTimeout(r.t.next);
    if (r.players.some(p => !p.on)) { r.waiting = true; r.waitRetakes = retakes; r.phase = 'waiting'; emit(r, 'room', { room: roomView(r) }); return; }
    r.waiting = false;
    const side = Rules.shooterOf(r.sh), keeper = 1 - side, nowMs = now();
    r.k++;
    r.turn = { k: r.k, side, keeper, retakes, whistleAt: nowMs + T.whistleMs, deadline: nowMs + T.whistleMs + T.aimMs, input: null, runAt: 0, strikeAt: 0, feint: null, dive: null, sim: null, sentIdx: 0, sentEv: 0, done: false, kzAtStrike: 0, kpAtStrike: null, diveDeadline: 0 };
    for (const p of r.players) { p.kp = { x: 0, kz: 0 }; p.inp = { mx: 0, mz: 0 }; }
    r.phase = 'aim';
    emit(r, 'turn', { k: r.k, shooter: side, keeper, retake: retakes, round: Rules.roundOf(r.sh, side), whistleAt: r.turn.whistleAt, deadline: r.turn.deadline, ...scoreView(r), cards: r.players.map(p => p.yellow) });
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

  function onShoot(r, i, d) {
    const t = r.turn; if (!t || r.phase !== 'aim' || i !== t.side || now() < t.whistleAt) return;
    t.input = { ax: clamp(num(d.ax), -1.4, 1.4), ay: clamp(num(d.ay), 0, 1.45), pw: clamp(num(d.pw, 0.5), 0.2, 1), curve: clamp(num(d.curve), -1, 1) };
    clearTimeout(r.t.aim); r.phase = 'runup'; t.runAt = now(); t.strikeAt = t.runAt + RUN;
    emit(r, 'runup', { k: t.k, runAt: t.runAt, strikeAt: t.strikeAt, runMs: RUN });
    r.t.strike = setTimeout(() => strike(r), RUN);
  }
  function onFeint(r, i) {
    const t = r.turn; if (!t || r.phase !== 'runup' || i !== t.side || t.feint) return;
    const progress = (now() - t.runAt) / RUN; if (progress < 0.05 || progress >= 1) return;
    t.feint = { progress: +progress.toFixed(3) }; t.strikeAt += FDELAY;
    clearTimeout(r.t.strike); r.t.strike = setTimeout(() => strike(r), Math.max(0, t.strikeAt - now()));
    emit(r, 'feint', { k: t.k, progress: t.feint.progress, strikeAt: t.strikeAt });
  }
  function onDive(r, i, d) {
    const t = r.turn; if (!t || i !== t.keeper || t.dive || (r.phase !== 'runup' && r.phase !== 'flight')) return;
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
    const decision = judge({ sim: t.sim, kz: t.kzAtStrike, feintProgress: t.feint ? t.feint.progress : null, keeperYellows: r.players[t.keeper].yellow, retakes: t.retakes });
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
      for (const c of d.cards) { const idx = c.who === 'shooter' ? t.side : t.keeper; r.players[idx].yellow++; }
      const base = { k: t.k, shooter: t.side, keeper: t.keeper, outcome: sim ? sim.outcome : 'miss', timeout: !!d.timeout, retake: !!d.retake, awardedGoal: !!d.awardedGoal, cards: d.cards, call: d.call, var: d.var ? { reasons: d.var.reasons, verdict: d.var.verdict } : null, measures: d.measures, cardsTotal: r.players.map(p => p.yellow) };
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
    const rec = { id: r.id, teamA: r.players[0].team.id, teamB: r.players[1].team.id, playerA: r.players[0].userId, playerB: r.players[1].userId, goalsA: table[0], goalsB: table[1],
      kicksA: r.sh ? r.sh.kicks[0] : 0, kicksB: r.sh ? r.sh.kicks[1] : 0, result, reason: forfeit ? 'forfeit' : reason, league: r.league, varCount: r.varCount,
      detail: { first: r.sh && r.sh.first, log: r.sh && r.sh.log, cards: r.players.map(p => p.yellow), vars: r.vars, actual: a } };
    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) { try { await store.recordPenMatch(rec); saved = true; } catch (e) { console.error('[aurex-pen] could not store result:', e.message); await new Promise(res => setTimeout(res, 400)); } }
    r.saved = saved;
    emit(r, 'end', { matchId: r.id, winner, result, reason: rec.reason, league: r.league, table, actual: a, saved, ...(r.sh ? scoreView(r) : {}), players: r.players.map(pub), varCount: r.varCount, cards: r.players.map(p => p.yellow) });
    for (const p of r.players) if (p && userRoom.get(p.userId) === r) userRoom.delete(p.userId);
    r.t.cleanup = setTimeout(() => destroy(r), T.cleanupMs);
  }
  function startForfeitTimer(r, i) {
    const p = r.players[i]; clearTimeout(p.dt);
    p.dt = setTimeout(() => {
      if (p.on || r.ended || !r.sh) return;
      if (r.players.every(q => !q.on)) { r.ended = true; destroy(r); return; }     // both gone: nobody wins, nothing is recorded
      finishMatch(r, 1 - i, 'forfeit', true);
    }, T.reconnectMs);
  }

  /* ---------------------------------------------------------------- sockets */
  nsp.on('connection', socket => {
    const u = socket.data.user, old = userSocket.get(u.id);
    if (old && old !== socket) { old.emit('err', { code: 'OPENED_ELSEWHERE', message: 'AUREX was opened in another tab or device.' }); old.data.replaced = true; old.disconnect(true); }
    userSocket.set(u.id, socket);
    const wrap = fn => (...a) => { try { fn(...a); } catch (e) { console.error('[aurex-pen] handler error:', e); } };
    const room = () => userRoom.get(u.id);

    // reconnect into a running match
    const r0 = room();
    if (r0) {
      const i = idxOf(r0, u.id), p = r0.players[i]; p.on = true; clearTimeout(p.dt); socket.join(r0.code);
      socket.emit('joined', { you: i, code: r0.code, room: roomView(r0), ts: now(), resumed: true });
      if (r0.sh && r0.phase !== 'lobby') {
        const t = r0.turn;
        socket.emit('sync', { you: i, room: roomView(r0), phase: r0.phase, matchId: r0.id, league: r0.league, ...(r0.sh ? scoreView(r0) : {}), cards: r0.players.map(q => q.yellow),
          turn: t ? { k: t.k, shooter: t.side, keeper: t.keeper, retake: t.retakes, whistleAt: t.whistleAt, deadline: t.deadline, strikeAt: t.strikeAt, runAt: t.runAt, keeperPos: r0.players[t.keeper].kp, dive: t.dive, feint: t.feint } : null, ts: now() });
      }
      emit(r0, 'room', { room: roomView(r0) });
      if (r0.waiting && r0.players.every(q => q.on)) nextKick(r0, r0.waitRetakes || 0);
    } else socket.emit('hello', { user: u, team: socket.data.team, error: socket.data.teamError, ts: now() });

    socket.on('ping:t', wrap(cb => { if (typeof cb === 'function') cb(now()); }));
    socket.on('quick', wrap(() => { if (room() || !checkEligible(socket)) return; tryQuick(socket); }));
    socket.on('create', wrap(() => {
      if (room() || !checkEligible(socket)) return;
      const r = makeRoom(); const i = seat(r, socket); socket.emit('joined', { you: i, code: r.code, room: roomView(r), ts: now() }); lobbyUpdate(r);
    }));
    socket.on('join', wrap(d => {
      if (room() || !checkEligible(socket)) return;
      const code = String(d && d.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5), r = rooms.get(code);
      if (!r || r.phase !== 'lobby') return socket.emit('err', { code: 'ROOM_NOT_FOUND', message: 'Room not found or already started.' });
      if (r.players[0] && r.players[0].team.id === socket.data.team.id) return socket.emit('err', { code: 'SAME_TEAM', message: 'You cannot play against your own team.' });
      if (r.players[0] && r.players[1]) return socket.emit('err', { code: 'ROOM_FULL', message: 'Room is full.' });
      const i = seat(r, socket); r.players.forEach(p => { if (p) p.ready = false; });
      socket.emit('joined', { you: i, code: r.code, room: roomView(r), ts: now() }); lobbyUpdate(r);
    }));
    socket.on('leave', wrap(() => leaveLobby(socket)));
    socket.on('ready', wrap(() => {
      const r = room(); if (!r || r.phase !== 'lobby' || !r.players[0] || !r.players[1]) return;
      r.players[idxOf(r, u.id)].ready = true; lobbyUpdate(r);
      if (r.players.every(p => p.ready)) startMatch(r).catch(e => console.error('[aurex-pen] start failed:', e));
    }));
    socket.on('shoot', wrap(d => { const r = room(); if (r) onShoot(r, idxOf(r, u.id), d || {}); }));
    socket.on('feint', wrap(() => { const r = room(); if (r) onFeint(r, idxOf(r, u.id)); }));
    socket.on('kin', wrap(d => {
      const r = room(); if (!r || !r.turn) return; const i = idxOf(r, u.id); if (i !== r.turn.keeper) return;
      const p = r.players[i], tn = now(); if (p.lastKin && tn - p.lastKin < 15) return; p.lastKin = tn;   // flood guard
      p.inp = { mx: sgn(num(d && d.mx)), mz: sgn(num(d && d.mz)) };
    }));
    socket.on('dive', wrap(d => { const r = room(); if (r) onDive(r, idxOf(r, u.id), d || {}); }));
    socket.on('disconnect', wrap(() => {
      if (userSocket.get(u.id) === socket) userSocket.delete(u.id);
      queue = queue.filter(q => q.userId !== u.id);
      if (socket.data.replaced) return;
      const r = room(); if (!r) return;
      const i = idxOf(r, u.id), p = r.players[i]; if (!p) return;
      p.on = false;
      if (r.phase === 'lobby') { leaveLobby(socket); return; }
      if (r.ended) return;
      emit(r, 'room', { room: roomView(r) });
      if (r.sh) startForfeitTimer(r, i);
      else { r.phase = 'lobby'; leaveLobby(socket); }
    }));
  });

  return { rooms, userRoom, nsp, _queue: () => queue };
}

module.exports = { attach, DEFAULT_TIMING };
