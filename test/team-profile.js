// AUREX team profile: public view, privacy of unapproved teams, record / form / next match built from stored penalty matches.
const assert = require('assert');
const { createApi } = require('../aurex/api'); const mem = require('../aurex/store-mem');

(async () => {
  const store = mem.create(), api = createApi({ store, env: { NODE_ENV: 'test', TRUST_PROXY: '0' } }), core = api.core;
  let ip = 0;
  const mk = async name => { const s = await core.register('10.2.0.' + (++ip), 'ua', { username: name, password: 'Strong-Pass-1', confirmPassword: 'Strong-Pass-1' }); return { ...s.user, token: s.token }; };
  const mkTeam = async (name, n1, n2, status) => {
    const p1 = await mk(n1), p2 = await mk(n2);
    const t = await core.registerTeam(p1, { name, teamPassword: 'secret1', player1Username: p1.username, player2Username: p2.username });
    if (status) await store.updateTeam(t.id, { status, teamCode: 'AX-' + String(t.id).padStart(4, '0') });
    return { ...t, p1, p2 };
  };
  const A = await mkTeam('Alpha FC', 'alice', 'adam', 'active'), B = await mkTeam('Bravo FC', 'bob', 'ben', 'active'), P = await mkTeam('Pending FC', 'pat', 'pam', null);
  const outsider = await mk('zed');

  // a fresh team: identity, captain, squad, empty record
  let d = await core.teamProfile(null, A.id);
  assert.strictEqual(d.team.name, 'Alpha FC'); assert.strictEqual(d.team.teamCode, 'AX-' + String(A.id).padStart(4, '0')); assert.strictEqual(d.team.status, 'active');
  assert.strictEqual(d.captain.username, 'alice'); assert.deepStrictEqual(d.members.map(m => [m.username, m.role]), [['alice', 'Captain'], ['adam', 'Player']]);
  assert.strictEqual(d.club, null, 'no club picked'); assert.strictEqual(d.overall.played, 0); assert.strictEqual(d.overall.winRate, null); assert.deepStrictEqual(d.recent, []); assert.strictEqual(d.next, null); assert.strictEqual(d.isMine, false);
  assert(!JSON.stringify(d).includes('passHash') && !JSON.stringify(d).includes('roomCode'), 'nothing secret leaves the server');

  // not approved yet: hidden from the public and strangers, visible to its own players and the owner
  await assert.rejects(core.teamProfile(null, P.id), /not found/i); await assert.rejects(core.teamProfile(outsider, P.id), /not found/i); await assert.rejects(core.teamProfile(null, 99999), /not found/i);
  assert.strictEqual((await core.teamProfile(P.p1, P.id)).isMine, true);
  await store.updateUser(outsider.id, { role: 'OWNER' }); assert.strictEqual((await core.teamProfile(await store.getUserById(outsider.id), P.id)).team.status, 'pending');

  // results: A beats B 3-1, loses 2-4 in a friendly, draws 2-2 (sudden death cap)
  const rec = (id, a, b, ga, gb, extra) => store.recordPenMatch({ id, teamA: a, teamB: b, playerA: a === A.id ? A.p1.id : B.p1.id, playerB: b === A.id ? A.p1.id : B.p1.id, goalsA: ga, goalsB: gb, kicksA: 5, kicksB: 5,
    result: ga > gb ? 'A' : gb > ga ? 'B' : 'DRAW', reason: 'normal', league: false, stage: 'friendly', fixtureId: null, winnerTeam: null, ...extra });
  await rec('m1', A.id, B.id, 3, 1); await new Promise(r => setTimeout(r, 5));
  await rec('m2', B.id, A.id, 4, 2); await new Promise(r => setTimeout(r, 5));
  await rec('m3', A.id, B.id, 2, 2);
  d = await core.teamProfile(null, A.id);
  assert.deepStrictEqual({ p: d.overall.played, w: d.overall.won, d: d.overall.drawn, l: d.overall.lost, gf: d.overall.gf, ga: d.overall.ga, gd: d.overall.gd, wr: d.overall.winRate }, { p: 3, w: 1, d: 1, l: 1, gf: 7, ga: 7, gd: 0, wr: 33 }, 'record counts from the team\'s own side, whichever side it was on');
  assert.deepStrictEqual(d.form, ['W', 'L', 'D'], 'form runs oldest -> newest'); assert.strictEqual(d.recent[0].result, 'D'); assert.strictEqual(d.recent[0].opponent.name, 'Bravo FC'); assert.strictEqual(d.recent.length, 3);
  const bp = await core.teamProfile(null, B.id); assert.deepStrictEqual(bp.form, ['L', 'W', 'D']); assert.strictEqual(bp.overall.won, 1);
  assert.strictEqual(d.league.started, false); assert.strictEqual(d.league.row, null, 'friendlies never create a table position');

  // started league: position in the table + next announced match (without the room code)
  const C = await mkTeam('Charlie FC', 'cat', 'cal', 'active'), D = await mkTeam('Delta FC', 'dan', 'dee', 'active');
  const owner = await store.getUserById(outsider.id); assert((await core.admin.startPenLeague(owner)).ok);
  const when = new Date(Date.now() + 3600e3).toISOString(); await core.admin.addPenFixture(owner, { teamA: A.id, teamB: C.id, scheduledAt: when });
  d = await core.teamProfile(A.p1, A.id);
  assert.strictEqual(d.league.inLeague, true); assert.strictEqual(d.league.teamCount, 4); assert.strictEqual(d.league.row.played, 0); assert(d.league.row.rank >= 1 && d.league.row.rank <= 4);
  assert.strictEqual(d.next.opponent.name, 'Charlie FC'); assert.strictEqual(d.next.stage, 'league'); assert.strictEqual(d.next.open, false); assert.strictEqual(d.isMine, true);
  assert.strictEqual((await core.teamProfile(null, C.id)).next.opponent.name, 'Alpha FC');
  assert.strictEqual((await core.teamProfile(null, D.id)).next, null);

  // the HTTP route is public and returns the same shape
  const out = await new Promise((res, rej) => { const req = { url: '/api/aurex/teams/' + A.id + '/profile', method: 'GET', headers: { host: 'x' }, socket: { remoteAddress: '1.1.1.1' } };
    let body = '', status = 0; const resp = { writeHead(s) { status = s; }, end(b) { body = b; res({ status, body }); } }; api(req, resp).catch(rej); });
  assert.strictEqual(out.status, 200); assert.strictEqual(JSON.parse(out.body).team.name, 'Alpha FC');
  console.log('team-profile tests passed');
})().catch(e => { console.error(e); process.exit(1); });
