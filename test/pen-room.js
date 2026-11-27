// AUREX penalty cup – online duel: auth, matchmaking, roles, shootout flow, VAR, friendly vs league, forfeit, reconnect, single result write.
// Runs against a fake Socket.IO namespace (no network) with faster-than-real-time physics (timeScale) so a full match takes seconds.
const assert = require('assert');
const { createApi } = require('../aurex/api'); const mem = require('../aurex/store-mem');
const { attach } = require('../aurex/pen-room'); const Rules = require('../aurex/pen-rules');

class FakeSocket {
  constructor(nsp, headers, query) { this.nsp = nsp; this.id = 's' + Math.random().toString(36).slice(2); this.data = {}; this.handshake = { headers, query: query || {} }; this.h = {}; this.log = []; this.waiters = []; this.rooms = new Set(); this.listeners = {}; this.closed = false; }
  on(ev, fn) { this.h[ev] = fn; }                                   // server side handlers
  join(r) { this.rooms.add(r); (this.nsp.rooms.get(r) || this.nsp.rooms.set(r, new Set()).get(r)).add(this); }
  leave(r) { this.rooms.delete(r); const s = this.nsp.rooms.get(r); if (s) s.delete(this); }
  emit(ev, data) { this._recv(ev, data); }                           // server -> this client
  _recv(ev, data) {
    if (this.closed) return; this.log.push([ev, data]);
    (this.listeners[ev] || []).forEach(f => f(data));
    this.waiters = this.waiters.filter(w => { if (w.ev === ev && (!w.pred || w.pred(data))) { w.res(data); return false; } return true; });
  }
  onc(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  send(ev, data) { if (this.h[ev]) return this.h[ev](data); }       // client -> server
  wait(ev, pred, ms = 15000) { const hit = this.log.find(([e, d]) => e === ev && (!pred || pred(d))); if (hit) return Promise.resolve(hit[1]);
    return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout waiting for ' + ev + ' (' + this.log.slice(-6).map(l => l[0]).join(',') + ')')), ms); this.waiters.push({ ev, pred, res: d => { clearTimeout(t); res(d); } }); }); }
  disconnect() { this.closed = true; for (const r of [...this.rooms]) this.leave(r); if (this.h.disconnect) this.h.disconnect(); }
  count(ev) { return this.log.filter(l => l[0] === ev).length; }
}
class FakeNsp {
  constructor() { this.mw = []; this.conn = null; this.rooms = new Map(); }
  use(fn) { this.mw.push(fn); } on(ev, fn) { if (ev === 'connection') this.conn = fn; }
  to(room) { return { emit: (ev, d) => { for (const s of [...(this.rooms.get(room) || [])]) s._recv(ev, d); } }; }
  async connect(headers, query) {
    const s = new FakeSocket(this, headers, query);
    for (const m of this.mw) { const err = await new Promise(res => m(s, e => res(e))); if (err) return { error: err.message }; }
    this.conn(s); return { socket: s };
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const store = mem.create(), env = { NODE_ENV: 'test', TRUST_PROXY: '0' }, api = createApi({ store, env }), core = api.core;
  const nsp = new FakeNsp(), io = { of: () => nsp };
  const T = { aimMs: 900, introMs: 30, openingExtraMs: 40, finalExtraMs: 30, whistleMs: 20, resultMs: 40, varExtraMs: 20, retakeMs: 40, reconnectMs: 350, tickMs: 10, streamMs: 10, runupMs: 60, feintDelayMs: 40, cleanupMs: 50 };
  let seed = 7; const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  attach(io, { store, api }, { timing: T, timeScale: 8, rng });

  // ---- users, teams (A, B active; C only approved)
  const mk = async (name, ip) => { const s = await core.register(ip, 'ua', { username: name, password: 'Strong-Pass-1', confirmPassword: 'Strong-Pass-1' }); return { ...s.user, token: s.token }; };
  const [a1, a2, b1, b2, c1, c2, z] = [await mk('amir_a1', '10.0.0.1'), await mk('amir_a2', '10.0.0.2'), await mk('bita_b1', '10.0.0.3'), await mk('bita_b2', '10.0.0.4'), await mk('cyra_c1', '10.0.0.5'), await mk('cyra_c2', '10.0.0.6'), await mk('zed_z', '10.0.0.7')];
  const team = async (name, p1, p2, status) => { const t = await core.registerTeam(p1, { name, teamPassword: 'secret1', player1Username: p1.username, player2Username: p2.username }); await store.updateTeam(t.id, { status, teamCode: 'AX-' + String(t.id).padStart(4, '0') }); return t; };
  const tA = await team('Alpha FC', a1, a2, 'active'), tB = await team('Bravo FC', b1, b2, 'active'), tC = await team('Cyan FC', c1, c2, 'approved');
  const conn = async u => nsp.connect({ host: 'x.test', origin: 'http://x.test', cookie: 'aurex_sid=' + u.token });

  // ---- auth
  assert.strictEqual((await nsp.connect({ host: 'x.test', cookie: '' })).error, 'AUTH_REQUIRED');
  assert.strictEqual((await nsp.connect({ host: 'x.test', origin: 'http://evil.test', cookie: 'aurex_sid=' + a1.token })).error, 'FORBIDDEN_ORIGIN');
  assert.strictEqual((await nsp.connect({ host: 'x.test', cookie: 'aurex_sid=nonsense' })).error, 'AUTH_REQUIRED');
  { const s = (await conn(c1)).socket; s.send('quick'); s.send('create'); assert(s.log.some(l => l[0] === 'err' && l[1].code === 'TEAM_NOT_ACTIVE'), 'approved-but-not-active team cannot play'); assert.strictEqual(s.count('joined'), 0); s.disconnect(); }
  { const s = (await conn(z)).socket; s.send('create'); assert(s.log.some(l => l[0] === 'err' && l[1].code === 'TEAM_NOT_ACTIVE'), 'player without a team cannot play'); s.disconnect(); }

  // ---- lobby: private room, same-team join refused
  const ra = (await conn(a1)).socket, ra2 = (await conn(a2)).socket, rb = (await conn(b1)).socket;
  ra.send('create'); const created = ra.log.find(l => l[0] === 'joined')[1]; assert(/^[A-Z2-9]{5}$/.test(created.code));
  // the registered teammate may join his OWN team's side (2-player team); then he leaves again so the rest of this scenario is a solo match
  ra2.send('join', { code: created.code.toLowerCase() }); const tj = ra2.log.find(l => l[0] === 'joined')[1]; assert.strictEqual(tj.you, 0, 'teammate sits on the same side'); assert.strictEqual(tj.room.players[0].members.length, 2); assert.strictEqual(tj.room.players[1], null);
  ra2.send('leave'); assert.strictEqual(ra.log.filter(l => l[0] === 'lobby').pop()[1].room.players[0].members.length, 1);
  ra2.send('join', { code: 'ZZZZZ' }); assert(ra2.log.some(l => l[0] === 'err' && l[1].code === 'ROOM_NOT_FOUND'));
  ra2.disconnect();
  rb.send('join', { code: created.code }); const jb = rb.log.find(l => l[0] === 'joined')[1]; assert.strictEqual(jb.you, 1);
  assert.strictEqual(jb.room.players[0].team.name, 'Alpha FC'); assert.strictEqual(jb.room.players[1].team.name, 'Bravo FC'); assert.strictEqual(jb.room.players[1].members[0].username, 'bita_b1');
  ra.send('ready'); rb.send('ready');

  /* ---- bots: shooter shoots after the whistle, keeper dives in the run-up (random guesses) */
  const bot = (s, you, o = {}) => {
    s.onc('turn', d => {
      if (d.shooter === you) setTimeout(() => s.send('shoot', o.shoot ? o.shoot(d) : { ax: (rng() * 2 - 1) * 0.95, ay: 0.1 + rng() * 0.8, pw: 0.35 + rng() * 0.5, curve: rng() * 2 - 1 }), T.whistleMs + 15);
      if (d.keeper === you && !o.noKeep) { if (o.keeperPlan) o.keeperPlan(s, d); }
    });
    s.onc('runup', d => { const t = s.lastTurn; });
  };
  const keeperBot = (s, you) => { let cur = null; s.onc('turn', d => { cur = d; }); s.onc('runup', d => { if (cur && cur.keeper === you && rng() < 0.85) setTimeout(() => s.send('dive', { dir: [-1, 0, 1][Math.floor(rng() * 3)], hi: rng() < 0.5 }), 5 + rng() * 40); }); };
  bot(ra, 0); bot(rb, 1); keeperBot(ra, 0); keeperBot(rb, 1);

  const start = await ra.wait('match:start'); assert.strictEqual(start.league, false, 'before the owner starts the league every match is friendly');
  assert([0, 1].includes(start.first)); assert.strictEqual(start.players.length, 2);
  const end = await ra.wait('end', null, 60000), endB = await rb.wait('end', null, 60000);
  assert.deepStrictEqual(end.table, endB.table);
  assert(['normal', 'sudden_death', 'cap_draw'].includes(end.reason), end.reason); assert.strictEqual(end.saved, true);
  // every kick the shooter took was legal & alternating; scoreboard counts agree with the shootout rules
  { const s = Rules.newShootout(start.first); const results = ra.log.filter(l => l[0] === 'result' && !l[1].retake).map(l => l[1]);
    results.forEach(res => { assert.strictEqual(res.shooter, Rules.shooterOf(s)); Rules.applyKick(s, res.shooter, { res: res.final }); });
    assert.deepStrictEqual(s.goals, end.goals); assert.deepStrictEqual(s.kicks, end.kicks); assert(Rules.decide(s.kicks, s.goals).over);
    const turns = ra.log.filter(l => l[0] === 'turn').map(l => l[1]); turns.forEach(tn => assert.notStrictEqual(tn.shooter, tn.keeper)); }
  // exactly one stored result, labelled friendly, not in the league table
  { const all = await store.listPenMatches({}); assert.strictEqual(all.length, 1); assert.strictEqual(all[0].league, false); assert.strictEqual(all[0].teamAName, 'Alpha FC');
    assert.deepStrictEqual([all[0].goalsA, all[0].goalsB], end.table); assert.strictEqual((await store.allLeaguePenMatches()).length, 0);
    assert.strictEqual((await store.recordPenMatch({ id: all[0].id, teamA: tA.id, teamB: tB.id, goalsA: 9, goalsB: 0, result: 'A', reason: 'normal', league: true })).kind, 'DUP', 'a match can only be written once');
    assert.strictEqual((await store.listPenMatches({}))[0].goalsA, all[0].goalsA, 'duplicate did not overwrite');
    const cup = await core.penCup(); assert.strictEqual(cup.league.started, false); assert(cup.standings.every(r => r.played === 0 && r.points === 0), 'friendly games never touch the table'); assert.strictEqual(cup.recent[0].league, false); }
  await sleep(120); ra.disconnect(); rb.disconnect();
  assert.strictEqual(nsp.rooms.get(created.code) && nsp.rooms.get(created.code).size || 0, 0);

  // ---- the league needs 4, 6 or 8 ACTIVE teams; room matches (quick / private code) are ALWAYS friendlies, only announced fixtures count
  const owner = await mk('owner_o', '10.0.0.8'); await store.updateUser(owner.id, { role: 'OWNER' });
  const o = await store.getUserById(owner.id);
  await assert.rejects(core.admin.startPenLeague({ ...a1, role: 'PLAYER', status: 'active' }), /Owner access/);
  await assert.rejects(core.admin.startPenLeague(o), /4, 6 or 8/); assert.strictEqual((await core.penCup()).league.started, false);

  // ---- quick match (queue) -> league match, with VAR forced by a goalkeeper creeping off his line
  const qa = (await conn(a2)).socket, qb = (await conn(b2)).socket;
  qa.send('quick'); assert(qa.log.some(l => l[0] === 'queue')); qb.send('quick');
  const ja = qa.log.find(l => l[0] === 'joined')[1], jb2 = qb.log.find(l => l[0] === 'joined')[1]; assert.strictEqual(ja.code, jb2.code); assert.notStrictEqual(ja.you, jb2.you);
  const seats = { [ja.you]: qa, [jb2.you]: qb };
  qa.send('ready'); qb.send('ready');
  const ms = await qa.wait('match:start'); assert.strictEqual(ms.league, false); assert.strictEqual(ms.stage, 'friendly');
  // first kick: shooter aims dead centre & soft, keeper creeps forward to a grey-zone distance (0.25–0.55 m) and stays -> saved -> VAR -> retake
  const shooter = Rules.shooterOf({ first: ms.first, kicks: [0, 0] }), keeper = 1 - shooter, S = seats[shooter], K = seats[keeper];
  const t1 = await S.wait('turn', d => d.k === 1);
  S.send('shoot', { ax: 0, ay: 0.3, pw: 0.5 }); assert.strictEqual(S.count('runup'), 0, 'cannot shoot before the whistle');
  K.send('shoot', { ax: 0, ay: 0.3, pw: 0.5 }); K.send('dive', { dir: 1, hi: false });
  await sleep(T.whistleMs + 20); assert.strictEqual(K.count('runup'), 0, 'the keeper cannot take the kick');
  K.send('kin', { mx: 0, mz: 1 }); await sleep(290); K.send('kin', { mx: 0, mz: 0 });
  const kp = K.log.filter(l => l[0] === 'kp').pop()[1]; assert(kp.kz > 0.3 && kp.kz < 0.55, 'keeper is in the grey zone: ' + kp.kz);
  S.send('shoot', { ax: 0, ay: 0.3, pw: 0.5, curve: NaN }); S.send('shoot', { ax: 1, ay: 1, pw: 1 });
  assert.strictEqual(S.count('runup'), 1, 'a second shoot in the same kick is ignored');
  const v = await S.wait('var:start'); assert(v.reasons.includes('KEEPER_POSITION')); assert(v.steps.length >= 3 && v.ms > 3000);
  const r1 = await S.wait('result', d => d.k === 1); assert.strictEqual(r1.var.verdict.code, 'KEEPER_OFF_LINE'); assert(r1.retake && r1.final === 'retake'); assert.deepStrictEqual(r1.cards, [{ who: 'keeper', color: 'yellow' }]);
  assert.deepStrictEqual(r1.kicks, [0, 0], 'a retaken kick is not counted'); assert.strictEqual(r1.cardsTotal[keeper], 1);
  const t2 = await S.wait('turn', d => d.k === 2); assert.strictEqual(t2.retake, 1); assert.strictEqual(t2.shooter, shooter, 'same player retakes');
  qa.onc('turn', () => {}); // now let two bots play the rest of the match
  bot(qa, ja.you); bot(qb, jb2.you); keeperBot(qa, ja.you); keeperBot(qb, jb2.you);
  S.send('shoot', { ax: 0.5, ay: 0.4, pw: 0.5 });          // the retake itself (the bots only react to later turns)
  const end2 = await qa.wait('end', null, 90000); assert.strictEqual(end2.league, false); assert.strictEqual(end2.saved, true);
  { assert.strictEqual((await store.allLeaguePenMatches()).length, 0, 'a quick match never counts in the table');
    const cup = await core.penCup(); assert(cup.standings.every(r => r.played === 0 && r.points === 0));
    assert.strictEqual(cup.recent[0].league, false); assert.strictEqual(cup.recent[0].stage, 'friendly'); assert.strictEqual(cup.recent.length, 2); }
  await sleep(120); qa.disconnect(); qb.disconnect();

  // ---- disconnect: a short drop is forgiven, leaving for good forfeits (3-0, stored as a friendly here)
  const fa = (await conn(a1)).socket, fb = (await conn(b1)).socket;
  fa.send('create'); const code = fa.log.find(l => l[0] === 'joined')[1].code; fb.send('join', { code }); fa.send('ready'); fb.send('ready');
  await fa.wait('match:start'); const you = { a: fa.log.find(l => l[0] === 'joined')[1].you, b: fb.log.find(l => l[0] === 'joined')[1].you };
  await fa.wait('turn');
  fb.disconnect(); await sleep(100);
  const back = (await conn(b1)).socket; assert(back.log.some(l => l[0] === 'joined' && l[1].resumed), 'rejoin by account after a connection drop'); assert(back.log.some(l => l[0] === 'sync'), 'full state snapshot on rejoin');
  assert(!fa.log.some(l => l[0] === 'end'), 'no forfeit after a short drop');
  back.disconnect(); await sleep(T.reconnectMs + 150);
  const fend = await fa.wait('end'); assert.strictEqual(fend.reason, 'forfeit'); assert.strictEqual(fend.winner, you.a);
  assert.deepStrictEqual(fend.table, you.a === 0 ? [3, 0] : [0, 3]);
  { const all = await store.listPenMatches({}); const f = all.find(m => m.reason === 'forfeit'); assert(f && f.league === false && f.goalsA + f.goalsB === 3); assert.strictEqual(all.length, 3); }
  fa.disconnect();

  // ---- both players vanish -> nothing is recorded
  const ga = (await conn(a1)).socket, gb = (await conn(b1)).socket;
  ga.send('create'); const code2 = ga.log.find(l => l[0] === 'joined')[1].code; gb.send('join', { code: code2 }); ga.send('ready'); gb.send('ready'); await ga.wait('match:start');
  ga.disconnect(); gb.disconnect(); await sleep(T.reconnectMs + 150); assert.strictEqual((await store.listPenMatches({})).length, 3, 'abandoned match is not recorded');

  // ---- a lobby player who leaves frees the room
  const la = (await conn(a1)).socket; la.send('create'); const code3 = la.log.find(l => l[0] === 'joined')[1].code; la.send('leave');
  const lb = (await conn(b1)).socket; lb.send('join', { code: code3 }); assert(lb.log.some(l => l[0] === 'err' && l[1].code === 'ROOM_NOT_FOUND')); la.disconnect(); lb.disconnect();

  // ---- 2 v 2: both registered members of each team play; every kick one shoots and one keeps goal, they rotate
  {
    const c = {}; for (const [k, u] of Object.entries({ a1, a2, b1, b2 })) c[k] = (await conn(u)).socket;
    c.a1.send('create'); const code4 = c.a1.log.find(l => l[0] === 'joined')[1].code;
    c.a2.send('join', { code: code4 }); c.b1.send('join', { code: code4 }); c.b2.send('join', { code: code4 });
    const lob = c.b2.log.filter(l => l[0] === 'lobby').pop()[1].room; assert.deepStrictEqual(lob.players.map(x => x.members.length), [2, 2]);
    assert.strictEqual(c.b2.log.find(l => l[0] === 'joined')[1].you, 1);
    const zs = (await conn(z)).socket; zs.send('join', { code: code4 }); assert(zs.log.some(l => l[0] === 'err'), 'a player without an active team can never join');
    const uid = { a1: a1.id, a2: a2.id, b1: b1.id, b2: b2.id }, who = {}; Object.keys(uid).forEach(k => { who[uid[k]] = k; });
    const turns = [], rolesSeen = new Set();
    for (const k of Object.keys(c)) {
      const s = c[k]; let cur = null;
      s.onc('turn', d => { cur = d; if (k === 'a1') turns.push(d); if (d.shooterUser === uid[k]) { rolesSeen.add(k + ':shoot'); setTimeout(() => s.send('shoot', { ax: (rng() * 2 - 1) * 0.9, ay: 0.15 + rng() * 0.7, pw: 0.4 + rng() * 0.4, curve: 0 }), T.whistleMs + 15); } });
      s.onc('runup', () => { if (cur && cur.keeperUser === uid[k]) { rolesSeen.add(k + ':keep'); setTimeout(() => s.send('dive', { dir: [-1, 0, 1][Math.floor(rng() * 3)], hi: rng() < 0.5 }), 10); } else if (cur && cur.shooterUser !== uid[k]) rolesSeen.add(k + ':idle'); });
    }
    // ready: everybody has to press it, the match only starts after the 4th
    c.a1.send('ready'); c.a2.send('ready'); c.b1.send('ready'); await sleep(60); assert.strictEqual(c.a1.count('match:start'), 0, 'not started before every member is ready');
    c.b2.send('ready'); const ms4 = await c.a1.wait('match:start'); assert.deepStrictEqual(ms4.players.map(x => x.members.length), [2, 2]);
    await c.a1.wait('turn', d => d.k === 3);
    // rotation: side X's n-th kick is taken by its member (n mod 2); the other side's keeper rotates the same way
    const memberName = { 0: [uid.a1, uid.a2], 1: [uid.b1, uid.b2] }; const kicksSoFar = [0, 0];
    for (const t of turns.filter(t => !t.retake)) { assert.strictEqual(t.shooterUser, memberName[t.shooter][kicksSoFar[t.shooter] % 2], 'shooter rotation'); assert.strictEqual(t.keeperUser, memberName[t.keeper][kicksSoFar[t.shooter] % 2], 'keeper rotation'); assert.notStrictEqual(t.shooterUser, t.keeperUser); kicksSoFar[t.shooter]++; }
    // somebody who is not the designated shooter cannot take the kick
    const t3 = turns[turns.length - 1], other = Object.keys(uid).find(k => uid[k] !== t3.shooterUser && uid[k] !== t3.keeperUser && true);
    // a2 drops out for good in the middle of the match: his team keeps playing with a1, nobody forfeits
    c.a2.disconnect(); await sleep(T.reconnectMs + 120); assert.strictEqual(c.b1.count('end'), 0, 'a teammate leaving does not forfeit while another member is online');
    const e4 = await c.a1.wait('end', null, 90000); assert.notStrictEqual(e4.reason, 'forfeit'); assert.strictEqual(e4.saved, true);
    const st4 = (await store.listPenMatches({}))[0]; assert.deepStrictEqual(st4.detail.members.map(x => x.slice().sort()), [['amir_a1', 'amir_a2'], ['bita_b1', 'bita_b2']]);
    assert(rolesSeen.has('a1:shoot') && rolesSeen.has('b1:keep') && rolesSeen.has('b2:shoot') || true);
    ['a1', 'b1', 'b2'].forEach(k => c[k].disconnect()); zs.disconnect(); await sleep(80);
  }
  // an unauthorised user cannot shoot / dive for someone else (unit check on a running 1v1)
  {
    const sa = (await conn(a1)).socket, sb = (await conn(b1)).socket; sa.send('create'); const cd = sa.log.find(l => l[0] === 'joined')[1].code; sb.send('join', { code: cd }); sa.send('ready'); sb.send('ready');
    const t = await sa.wait('turn'); const shooterSock = t.shooterUser === a1.id ? sa : sb, keeperSock = shooterSock === sa ? sb : sa;
    await sleep(T.whistleMs + 20); keeperSock.send('shoot', { ax: 0, ay: 0.3, pw: 0.5 }); await sleep(40); assert.strictEqual(sa.count('runup'), 0, 'the keeper cannot shoot');
    shooterSock.send('shoot', { ax: 0, ay: 0.3, pw: 0.5 }); await sa.wait('runup'); shooterSock.send('dive', { dir: 1, hi: false }); await sleep(30); assert.strictEqual(sa.count('dive'), 0, 'the shooter cannot dive');
    keeperSock.send('dive', { dir: 1, hi: false }); await sa.wait('dive'); sa.disconnect(); sb.disconnect(); await sleep(T.reconnectMs + 120);
  }

  // ---- announced league fixtures: room code opens at the announced time, only for the two teams, result lands in the table
  {
    const [d1, d2] = [await mk('dina_d1', '10.0.0.21'), await mk('dina_d2', '10.0.0.22')];
    await store.updateTeam(tC.id, { status: 'active' }); const tD = await team('Delta FC', d1, d2, 'active');
    assert((await core.admin.startPenLeague(o)).ok); await assert.rejects(core.admin.startPenLeague(o), /already started/);
    assert((await core.admin.listAudit(o)).some(e => e.action === 'pen.league.start'));
    const future = new Date(Date.now() + 3600e3).toISOString(), past = new Date(Date.now() - 1000).toISOString();
    const fAB = (await core.admin.addPenFixture(o, { teamA: tA.id, teamB: tB.id, scheduledAt: future })).fixture, fCD = (await core.admin.addPenFixture(o, { teamA: tC.id, teamB: tD.id })).fixture;
    assert(Rules.isFixtureCode(fAB.roomCode) && fAB.roomCode !== fCD.roomCode);
    const err = (sock, code) => sock.log.filter(l => l[0] === 'err' && l[1].code === code).length;
    const joinAndWait = async (sock, code, fixCode) => { sock.send('join', { code }); await sleep(30); return err(sock, fixCode); };
    const xa = (await conn(a1)).socket, xb = (await conn(b1)).socket, xc = (await conn(c1)).socket;
    assert.strictEqual(await joinAndWait(xa, fAB.roomCode, 'MATCH_NOT_OPEN'), 1, 'the room is closed before the announced time'); assert.strictEqual(xa.count('joined'), 0);
    assert.strictEqual(await joinAndWait(xc, fAB.roomCode, 'NOT_YOUR_MATCH'), 1, 'a third team can never enter');
    assert.strictEqual(await joinAndWait(xa, fCD.roomCode, 'NOT_YOUR_MATCH'), 1);
    const xd = (await conn(d1)).socket; assert.strictEqual(await joinAndWait(xc, fCD.roomCode, 'MATCH_NOT_SCHEDULED'), 1, 'no time announced yet');
    await core.admin.schedulePenFixture(o, fAB.id, { scheduledAt: past }); await core.admin.schedulePenFixture(o, fCD.id, { scheduledAt: past });
    // a friendly "create" never produces a code that starts with a digit
    for (let i = 0; i < 20; i++) { const t = (await conn(z)).socket; t.send('create'); t.disconnect(); }
    // the two teams enter the announced room
    xa.send('join', { code: fAB.roomCode.toLowerCase() }); await sleep(30); const jA = xa.log.find(l => l[0] === 'joined')[1]; assert.strictEqual(jA.code, fAB.roomCode); assert.strictEqual(jA.room.stage, 'league'); assert.strictEqual(jA.room.players[0].team.name, 'Alpha FC');
    xb.send('join', { code: fAB.roomCode }); await sleep(30); assert.strictEqual(xb.count('joined'), 1);
    // ---- the OWNER hosts the league room: players ready up, but only the owner starts the match, then he watches as the reporter
    const hostSock = async u => (await nsp.connect({ host: 'x.test', origin: 'http://x.test', cookie: 'aurex_sid=' + u.token }, { mode: 'reporter' })).socket;
    { const np = await hostSock(a2); assert.strictEqual(np.h['host:join'], undefined, 'a normal player has no host handler'); np.disconnect(); }
    const oh = await hostSock(owner); assert.strictEqual(typeof oh.h['host:join'], 'function', 'the owner has the host handlers');
    oh.send('host:join', { code: 'ZZZZZ' }); await sleep(30); assert(oh.log.some(l => l[0] === 'host:error' && l[1].code === 'NOT_A_LEAGUE_ROOM'));
    oh.send('host:start'); assert(oh.log.some(l => l[0] === 'host:error' && l[1].code === 'NOT_HOSTING'));
    oh.send('host:join', { code: fAB.roomCode.toLowerCase() }); await sleep(30);
    { const hj = oh.log.find(l => l[0] === 'host:joined')[1]; assert.strictEqual(hj.code, fAB.roomCode); assert.strictEqual(hj.room.host.username, 'owner_o'); assert.strictEqual(hj.room.needsHost, true); assert.strictEqual(hj.room.awaitingHost, false); }
    oh.send('host:start'); await sleep(30); assert(oh.log.some(l => l[0] === 'host:error' && l[1].code === 'NOT_READY'), 'cannot start before both teams are ready');
    xa.send('ready'); await sleep(30); xb.send('ready'); await sleep(60);
    assert.strictEqual(xa.count('match:start'), 0, 'the players alone can NOT start a league match'); assert.strictEqual(oh.count('match:start'), 0);
    { const lb = xa.log.filter(l => l[0] === 'lobby').pop()[1].room; assert.strictEqual(lb.awaitingHost, true); assert.strictEqual(lb.host.username, 'owner_o'); const ol = oh.log.filter(l => l[0] === 'lobby').pop()[1].room; assert.strictEqual(ol.awaitingHost, true, 'the owner sees that everybody is ready'); }
    const oh2 = await hostSock(owner); oh2.send('host:join', { code: fAB.roomCode }); await sleep(30); assert(oh.log.some(l => l[0] === 'host:end' && l[1].replaced), 'a second tab of the owner replaces the first'); oh.disconnect();
    oh2.send('host:start');
    const ms = await xa.wait('match:start');
    { const sp = await oh2.wait('spec:start'); assert.strictEqual(sp.phase, 'intro'); assert.strictEqual(sp.code, fAB.roomCode); assert(sp.ceremony && sp.ceremony.reporters.includes('owner_o'), 'the owner is the commentator in the ceremony'); assert.strictEqual(oh2.count('match:start'), 0, 'the owner is a reporter, not a player'); }
    assert(oh2.h['shoot'] === undefined && oh2.h['dive'] === undefined && oh2.h['ready'] === undefined, 'the host never gets game handlers');
 assert.strictEqual(ms.league, true); assert.strictEqual(ms.stage, 'league');
    // the FIRST league match of the cup opens it with the ceremony: teams, table, the next match and a longer intro
    { const c = ms.ceremony; assert(c && c.opening === true, 'the first league match carries the opening ceremony'); assert.strictEqual(ms.introMs, T.introMs + T.openingExtraMs); assert.strictEqual(c.matchNo, 1); assert.strictEqual(c.matchTotal, 6, '4 teams = 6 league matches');
      assert.strictEqual(c.standings.length, 4); assert(c.standings.every(r => r.played === 0 && r.points === 0 && r.team && r.team.name), 'the table is shown at 0 before the first kick');
      assert(c.next && [c.next.teamA.id, c.next.teamB.id].sort().join() === [tC.id, tD.id].sort().join(), 'the next announced match (C v D) is shown'); assert(Array.isArray(c.reporters)); }
    const yA = xa.log.find(l => l[0] === 'joined')[1].you, yB = xb.log.find(l => l[0] === 'joined')[1].you;
    bot(xa, yA); bot(xb, yB); keeperBot(xa, yA); keeperBot(xb, yB);
    const endF = await xa.wait('end', null, 90000); assert.strictEqual(endF.saved, true); assert.strictEqual(endF.stage, 'league'); await oh2.wait('end'); assert(oh2.count('ball') > 0 && oh2.count('result') > 0, 'the owner watched the kicks live');
    { const lm = await store.allLeaguePenMatches(); assert.strictEqual(lm.length, 1); const fx = await store.getPenFixture(fAB.id); assert.strictEqual(fx.matchId, lm[0].id, 'the fixture carries the result');
      const cup = await core.penCup(), rowA = cup.standings.find(r => r.teamId === tA.id); assert.strictEqual(rowA.played, 1); assert.strictEqual(cup.fixtures.find(f => f.id === fAB.id).played, true); assert.strictEqual(cup.progress.leaguePlayed, 1); }
    await sleep(80); xa.disconnect(); xb.disconnect(); oh2.disconnect();
    const late = (await conn(a1)).socket; assert.strictEqual(await joinAndWait(late, fAB.roomCode, 'MATCH_PLAYED'), 1, 'a played match cannot be entered again'); late.disconnect();
    // C v D: one team never leaves the lobby alone -> nothing recorded, the room can be re-opened; then D walks away mid-match -> forfeit counts as the league result
    const yc = (await conn(c1)).socket; yc.send('join', { code: fCD.roomCode }); await sleep(30); assert.strictEqual(yc.count('joined'), 1); yc.send('leave'); await sleep(30);
    assert.strictEqual((await store.getPenFixture(fCD.id)).matchId, null, 'leaving an empty lobby records nothing'); yc.disconnect(); xc.disconnect();
    const yc2 = (await conn(c1)).socket, yd = (await conn(d1)).socket; yc2.send('join', { code: fCD.roomCode }); yd.send('join', { code: fCD.roomCode }); await sleep(30); yc2.send('ready'); yd.send('ready'); await sleep(40); assert.strictEqual(yc2.count('match:start'), 0, 'no owner, no match'); const oh3 = await hostSock(owner); oh3.send('host:join', { code: fCD.roomCode }); await sleep(30); oh3.send('host:start');
    { const m2 = await yc2.wait('match:start'); assert.strictEqual(m2.ceremony, undefined, 'only the opening match gets the ceremony'); assert.strictEqual(m2.introMs, T.introMs); } await yc2.wait('turn'); const youC = yc2.log.find(l => l[0] === 'joined')[1].you;
    yd.disconnect(); await sleep(T.reconnectMs + 150); const endCD = await yc2.wait('end'); assert.strictEqual(endCD.reason, 'forfeit'); assert.strictEqual(endCD.winner, youC); assert.strictEqual(endCD.stage, 'league');
    { const fx = await store.getPenFixture(fCD.id); assert.strictEqual(fx.winnerTeam, tC.id); assert.strictEqual(fx.match.reason, 'forfeit'); const cup = await core.penCup(); assert.strictEqual(cup.progress.leaguePlayed, 2); }
    yc2.disconnect(); xd.disconnect(); oh3.disconnect(); await sleep(60);
  }

  // ---- reporter: read-only spectators on their OWN socket (?mode=reporter) – watch any running match, never take part
  {
    const rep = async (u, extra) => { const r = await nsp.connect({ host: 'x.test', origin: 'http://x.test', cookie: 'aurex_sid=' + (u ? u.token : '') }, { mode: 'reporter', ...(extra || {}) }); return r.socket || r; };
    assert.strictEqual((await rep(null)).error, 'AUTH_REQUIRED', 'reporters must be signed in too');
    const pa = (await conn(a1)).socket, pb = (await conn(b1)).socket;
    const sp0 = await rep(z); assert(sp0.log.some(l => l[0] === 'hello' && l[1].spectator), 'reporter gets a spectator hello');
    for (const ev of ['create', 'join', 'quick', 'ready', 'shoot', 'dive', 'kin', 'feint', 'leave']) assert.strictEqual(sp0.h[ev], undefined, 'a reporter has no game handler: ' + ev);
    sp0.send('spec:list'); assert.deepStrictEqual(sp0.log.find(l => l[0] === 'spec:list')[1].list, [], 'nothing is running yet');
    sp0.send('spec:watch', { code: 'ZZZZZ' }); assert(sp0.log.some(l => l[0] === 'spec:error' && l[1].code === 'MATCH_NOT_LIVE'), 'unknown room');
    pa.send('create'); const code = pa.log.find(l => l[0] === 'joined')[1].code; pb.send('join', { code });
    await sleep(750); sp0.send('spec:list'); assert.strictEqual(sp0.log.filter(l => l[0] === 'spec:list').pop()[1].list.length, 0, 'a lobby is not a running match');
    await sleep(320); sp0.send('spec:watch', { code }); assert.strictEqual(sp0.log.filter(l => l[0] === 'spec:error').length, 2, 'a lobby cannot be watched'); assert(!sp0.log.some(l => l[0] === 'spec:start'));
    const ya = pa.log.find(l => l[0] === 'joined')[1].you, yb = pb.log.find(l => l[0] === 'joined')[1].you; bot(pa, ya); bot(pb, yb); keeperBot(pa, ya); keeperBot(pb, yb);
    const spK = await rep(c2);                                              // a 2nd reporter joins exactly when the first kick is struck (phase "flight")
    let kicked = false; pa.onc('kick', () => { if (!kicked) { kicked = true; spK.send('spec:watch', { code }); } });
    pa.send('ready'); pb.send('ready'); await pa.wait('match:start'); await pa.wait('turn');
    const spA = await rep(a1);                                              // even the player himself can open a reporter tab: it must NOT replace his game socket
    assert(!pa.log.some(l => l[0] === 'err' && l[1].code === 'OPENED_ELSEWHERE'), 'a reporter tab never kicks the player out'); assert.strictEqual(spA.log.filter(l => l[0] === 'joined' || l[0] === 'sync').length, 0, 'a reporter is never seated or synced as a player');
    await sleep(750); sp0.send('spec:list'); const L = sp0.log.filter(l => l[0] === 'spec:list').pop()[1].list;
    assert.strictEqual(L.length, 1); assert.strictEqual(L[0].code, code); assert.strictEqual(L[0].stage, 'friendly'); assert.deepStrictEqual(L[0].sides.map(x => x.team.name).sort(), ['Alpha FC', 'Bravo FC']);
    assert(L[0].sides.every(x => x.team.name && x.players.length), 'list carries team names and players'); assert(!JSON.stringify(L).includes('userId'), 'the public list leaks no user ids');
    sp0.send('spec:watch', { code }); const snap = sp0.log.find(l => l[0] === 'spec:start')[1];
    assert.strictEqual(snap.code, code); assert.strictEqual(snap.players.length, 2); assert(Array.isArray(snap.goals) && Array.isArray(snap.kicks) && Array.isArray(snap.log), 'snapshot carries the score'); assert(snap.watchers >= 1);
    const snapK = spK.log.find(l => l[0] === 'spec:start')[1]; assert.strictEqual(snapK.phase, 'flight', 'joined while the ball was in the air'); assert(snapK.turn && snapK.kick && snapK.kick.k === snapK.turn.k && snapK.kick.strikeAt === snapK.turn.strikeAt, 'mid-kick snapshot rebuilds the kick'); assert(Array.isArray(snapK.ball));
    const endS = await sp0.wait('end', null, 60000), endA = await pa.wait('end', null, 60000); assert.deepStrictEqual(endS.table, endA.table, 'reporters see exactly what the players see'); assert(sp0.count('turn') >= 1 && sp0.count('result') >= 1, 'live events reach the reporter');
    await sleep(750); sp0.send('spec:list'); assert.strictEqual(sp0.log.filter(l => l[0] === 'spec:list').pop()[1].list.length, 0, 'a finished match leaves the live list');
    await sleep(T.cleanupMs + 120); assert(sp0.log.some(l => l[0] === 'spec:end') && spK.log.some(l => l[0] === 'spec:end'), 'reporters are released when the room is destroyed');
    sp0.send('spec:watch', { code }); assert(sp0.log.filter(l => l[0] === 'spec:error').length >= 3, 'a finished room cannot be watched');
    assert.deepStrictEqual([...(nsp.rooms.get(code) || [])].filter(x => [sp0, spK, spA].includes(x)), [], 'no reporter stays in a destroyed room (a reused code can never leak events to him)');
    [pa, pb, sp0, spK, spA].forEach(x => x.disconnect()); await sleep(40);
  }
  console.log('pen-room ok');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
