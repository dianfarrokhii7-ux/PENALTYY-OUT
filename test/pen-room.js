// AUREX penalty cup – online duel: auth, matchmaking, roles, shootout flow, VAR, friendly vs league, forfeit, reconnect, single result write.
// Runs against a fake Socket.IO namespace (no network) with faster-than-real-time physics (timeScale) so a full match takes seconds.
const assert = require('assert');
const { createApi } = require('../aurex/api'); const mem = require('../aurex/store-mem');
const { attach } = require('../aurex/pen-room'); const Rules = require('../aurex/pen-rules');

class FakeSocket {
  constructor(nsp, headers) { this.nsp = nsp; this.id = 's' + Math.random().toString(36).slice(2); this.data = {}; this.handshake = { headers }; this.h = {}; this.log = []; this.waiters = []; this.rooms = new Set(); this.listeners = {}; this.closed = false; }
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
  async connect(headers) {
    const s = new FakeSocket(this, headers);
    for (const m of this.mw) { const err = await new Promise(res => m(s, e => res(e))); if (err) return { error: err.message }; }
    this.conn(s); return { socket: s };
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const store = mem.create(), env = { NODE_ENV: 'test', TRUST_PROXY: '0' }, api = createApi({ store, env }), core = api.core;
  const nsp = new FakeNsp(), io = { of: () => nsp };
  const T = { aimMs: 900, introMs: 30, whistleMs: 20, resultMs: 40, varExtraMs: 20, retakeMs: 40, reconnectMs: 350, tickMs: 10, streamMs: 10, runupMs: 60, feintDelayMs: 40, cleanupMs: 50 };
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
  ra2.send('join', { code: created.code.toLowerCase() }); assert(ra2.log.some(l => l[0] === 'err' && l[1].code === 'SAME_TEAM'), 'teammates cannot face each other');
  ra2.send('join', { code: 'ZZZZZ' }); assert(ra2.log.some(l => l[0] === 'err' && l[1].code === 'ROOM_NOT_FOUND'));
  ra2.disconnect();
  rb.send('join', { code: created.code }); const jb = rb.log.find(l => l[0] === 'joined')[1]; assert.strictEqual(jb.you, 1);
  assert.strictEqual(jb.room.players[0].team.name, 'Alpha FC'); assert.strictEqual(jb.room.players[1].team.name, 'Bravo FC');
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

  // ---- the owner starts the league: only matches STARTED afterwards count
  const owner = await mk('owner_o', '10.0.0.8'); await store.updateUser(owner.id, { role: 'OWNER' });
  const o = await store.getUserById(owner.id);
  await assert.rejects(core.admin.startPenLeague({ ...a1, role: 'PLAYER', status: 'active' }), /Owner access/);
  const st = await core.admin.startPenLeague(o); assert(st.ok);
  await assert.rejects(core.admin.startPenLeague(o), /already started/);
  assert.strictEqual((await core.penCup()).league.started, true);
  assert((await core.admin.listAudit(o)).some(e => e.action === 'pen.league.start'));

  // ---- quick match (queue) -> league match, with VAR forced by a goalkeeper creeping off his line
  const qa = (await conn(a2)).socket, qb = (await conn(b2)).socket;
  qa.send('quick'); assert(qa.log.some(l => l[0] === 'queue')); qb.send('quick');
  const ja = qa.log.find(l => l[0] === 'joined')[1], jb2 = qb.log.find(l => l[0] === 'joined')[1]; assert.strictEqual(ja.code, jb2.code); assert.notStrictEqual(ja.you, jb2.you);
  const seats = { [ja.you]: qa, [jb2.you]: qb };
  qa.send('ready'); qb.send('ready');
  const ms = await qa.wait('match:start'); assert.strictEqual(ms.league, true, 'matches that start after the owner pressed START LEAGUE count');
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
  const end2 = await qa.wait('end', null, 90000); assert.strictEqual(end2.league, true); assert.strictEqual(end2.saved, true);
  { const lm = await store.allLeaguePenMatches(); assert.strictEqual(lm.length, 1);
    const cup = await core.penCup(), rowA = cup.standings.find(r => r.teamId === tA.id), rowB = cup.standings.find(r => r.teamId === tB.id), rowC = cup.standings.find(r => r.teamId === tC.id);
    assert.strictEqual(rowA.played, 1); assert.strictEqual(rowB.played, 1); assert.strictEqual(rowA.points + rowB.points, end2.result === 'DRAW' ? 2 : 3);
    assert.strictEqual(rowA.gf, end2.table[0]); assert.strictEqual(rowB.ga, end2.table[0]); assert.strictEqual(rowC.played, 0);
    assert.strictEqual(cup.recent[0].league, true); assert.strictEqual(cup.recent.length, 2); assert.strictEqual(cup.recent[1].league, false, 'the earlier friendly stays a friendly'); }
  await sleep(120); qa.disconnect(); qb.disconnect();

  // ---- disconnect: a short drop is forgiven, leaving for good forfeits (3-0 in the table, counted as a league match)
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
  { const all = await store.listPenMatches({}); const f = all.find(m => m.reason === 'forfeit'); assert(f && f.league === true && f.goalsA + f.goalsB === 3); assert.strictEqual(all.length, 3); }
  fa.disconnect();

  // ---- both players vanish -> nothing is recorded
  const ga = (await conn(a1)).socket, gb = (await conn(b1)).socket;
  ga.send('create'); const code2 = ga.log.find(l => l[0] === 'joined')[1].code; gb.send('join', { code: code2 }); ga.send('ready'); gb.send('ready'); await ga.wait('match:start');
  ga.disconnect(); gb.disconnect(); await sleep(T.reconnectMs + 150); assert.strictEqual((await store.listPenMatches({})).length, 3, 'abandoned match is not recorded');

  // ---- a lobby player who leaves frees the room
  const la = (await conn(a1)).socket; la.send('create'); const code3 = la.log.find(l => l[0] === 'joined')[1].code; la.send('leave');
  const lb = (await conn(b1)).socket; lb.send('join', { code: code3 }); assert(lb.log.some(l => l[0] === 'err' && l[1].code === 'ROOM_NOT_FOUND')); la.disconnect(); lb.disconnect();
  console.log('pen-room ok');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
