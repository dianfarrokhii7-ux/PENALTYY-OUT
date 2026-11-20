// AUREX penalty league: round robin + play-offs (4 / 6 / 8 teams), announced fixtures, room codes, walkovers.
// Core + store only (the room gating lives in test/pen-room.js).
const assert = require('assert');
const { createApi } = require('../aurex/api'); const mem = require('../aurex/store-mem'); const Rules = require('../aurex/pen-rules');

/* ---------- pure rules ---------- */
{
  assert.deepStrictEqual(Rules.roundRobinPairs([1, 2, 3, 4]).length, 6); assert.strictEqual(Rules.leagueMatchCount(8), 28);
  assert.deepStrictEqual(Rules.semiPairs([10, 20, 30, 40, 50, 60]), [[20, 30]], '6 teams: 2nd v 3rd');
  assert.deepStrictEqual(Rules.semiPairs([1, 2, 3, 4, 5, 6, 7, 8]), [[1, 4], [2, 3]], '8 teams: 1st v 4th, 2nd v 3rd');
  assert.deepStrictEqual(Rules.semiPairs([1, 2, 3, 4]), [], '4 teams: no play-offs');
  assert.deepStrictEqual(Rules.finalPair([1, 2, 3, 4, 5, 6], [3]), [1, 3], '6 teams: 1st waits in the final'); assert.deepStrictEqual(Rules.finalPair([1, 2, 3, 4, 5, 6, 7, 8], [4, 2]), [4, 2]);
  const rk = new Map([[7, 1], [9, 2]]); assert.strictEqual(Rules.knockoutWinner(9, 7, null, rk), 7, 'a drawn knock-out goes to the higher seed'); assert.strictEqual(Rules.knockoutWinner(9, 7, 9, rk), 9);
  for (let i = 0; i < 500; i++) { const c = Rules.makeFixtureCode(); assert(Rules.isFixtureCode(c), c); assert(!/^[A-Z]/.test(c)); }
}

(async () => {
  const mkWorld = async n => {
    const store = mem.create(), api = createApi({ store, env: { NODE_ENV: 'test', TRUST_PROXY: '0' } }), core = api.core;
    const mk = async (name, i) => { const s = await core.register('10.1.0.' + i, 'ua', { username: name, password: 'Strong-Pass-1', confirmPassword: 'Strong-Pass-1' }); return { ...s.user, token: s.token }; };
    const owner = await mk('owner_o', 250); await store.updateUser(owner.id, { role: 'OWNER' }); const o = await store.getUserById(owner.id);
    const teams = [];
    for (let i = 0; i < n; i++) { const p1 = await mk('pa' + i, 2 * i + 1), p2 = await mk('pb' + i, 2 * i + 2); const t = await core.registerTeam(p1, { name: 'Team ' + String.fromCharCode(65 + i), teamPassword: 'secret1', player1Username: p1.username, player2Username: p2.username }); await store.updateTeam(t.id, { status: 'active', teamCode: 'AX-' + String(t.id).padStart(4, '0') }); teams.push({ ...t, p1 }); }
    return { store, core, o, teams, owner, mk };
  };
  /** plays a fixture to the end like the match room does: records the match, then lets the league advance */
  const play = async (w, f, goalsA, goalsB) => {
    const result = goalsA > goalsB ? 'A' : goalsB > goalsA ? 'B' : 'DRAW';
    const rec = { id: 'm' + Math.random().toString(36).slice(2), teamA: f.teamA, teamB: f.teamB, playerA: 1, playerB: 2, goalsA, goalsB, kicksA: 5, kicksB: 5, result, reason: 'normal', league: f.stage === 'league', stage: f.stage, fixtureId: f.id, winnerTeam: result === 'A' ? f.teamA : result === 'B' ? f.teamB : null, varCount: 0 };
    const r = await w.store.recordPenMatch(rec); await w.core.penAdvance(); return r;
  };
  const fixtures = async (w, stage) => (await w.store.listPenFixtures()).filter(f => !stage || f.stage === stage);

  // ---------- start: only with 4, 6 or 8 ACTIVE teams, owner only ----------
  {
    const w = await mkWorld(3);
    await assert.rejects(w.core.admin.startPenLeague(w.o), /4, 6 or 8/);
    await assert.rejects(w.core.admin.startPenLeague({ ...w.teams[0].p1, role: 'PLAYER', status: 'active' }), /Owner access/);
    assert.strictEqual((await w.core.penCup()).league.phase, 'idle');
  }

  // ---------- 4 teams: the table leader is the champion, no play-offs ----------
  {
    const w = await mkWorld(4); const [A, B, C, D] = w.teams.map(t => t.id);
    assert((await w.core.admin.startPenLeague(w.o)).ok); await assert.rejects(w.core.admin.startPenLeague(w.o), /already started/);
    assert.strictEqual((await w.core.penCup()).league.phase, 'league'); assert.strictEqual((await w.core.penCup()).league.teamCount, 4);
    // the owner announces: pairing + time; the GAME picks the room code
    const when = new Date(Date.now() + 3600e3).toISOString();
    const r1 = await w.core.admin.addPenFixture(w.o, { teamA: A, teamB: B, scheduledAt: when }); assert(Rules.isFixtureCode(r1.fixture.roomCode)); assert.strictEqual(r1.fixture.scheduledAt, when);
    await assert.rejects(w.core.admin.addPenFixture(w.o, { teamA: B, teamB: A, scheduledAt: when }), /already have/, 'each pair plays exactly once (either way round)');
    await assert.rejects(w.core.admin.addPenFixture(w.o, { teamA: A, teamB: A }), /itself/); await assert.rejects(w.core.admin.addPenFixture(w.o, { teamA: A, teamB: 9999 }), /in the league/);
    await assert.rejects(w.core.admin.addPenFixture(w.o, { teamA: A, teamB: C, scheduledAt: 'tomorrow-ish' }), /valid date/);
    assert.strictEqual((await w.core.admin.generatePenFixtures(w.o)).created, 5, 'the other 5 pairings are created, time still open');
    assert.strictEqual((await w.core.admin.generatePenFixtures(w.o)).created, 0, 'generating twice adds nothing');
    const all = await fixtures(w); assert.strictEqual(all.length, 6); assert.strictEqual(new Set(all.map(f => f.roomCode)).size, 6, 'every match has its own room code');
    // room code visibility: owner and the two teams only; "open" only from the announced time
    { const pub = await w.core.penCup(null); assert(pub.fixtures.every(f => f.roomCode === null), 'the public never sees room codes');
      const own = await w.core.penCup(w.o); assert(own.fixtures.every(f => f.roomCode));
      const mineA = await w.core.penCup(w.teams[0].p1); const fa = mineA.fixtures.filter(f => f.mine); assert.strictEqual(fa.length, 3); assert(fa.every(f => f.roomCode)); assert(mineA.fixtures.filter(f => !f.mine).every(f => f.roomCode === null));
      assert(pub.fixtures.every(f => f.open === false), 'nothing is open before its time'); }
    await w.core.admin.schedulePenFixture(w.o, r1.fixture.id, { scheduledAt: new Date(Date.now() - 1000).toISOString() });
    assert.strictEqual((await w.core.penCup(null)).fixtures.find(f => f.id === r1.fixture.id).open, true, 'open once the announced time has come');
    // play the round robin: A beats everybody, B beats C and D, C beats D
    const by = (a, b) => all.find(f => Rules.pairKey(f.teamA, f.teamB) === Rules.pairKey(a, b));
    const res = [[A, B, 2, 1], [A, C, 3, 0], [A, D, 1, 0], [B, C, 2, 0], [B, D, 4, 3], [C, D, 1, 0]];
    for (const [a, b, ga, gb] of res.slice(0, 5)) { const f = by(a, b); await play(w, f, f.teamA === a ? ga : gb, f.teamA === a ? gb : ga); }
    assert.strictEqual((await w.core.penCup()).league.phase, 'league', 'not finished before every match is played'); assert.strictEqual((await w.core.penCup()).league.champion, null);
    const last = by(C, D); await assert.rejects(w.core.admin.deletePenFixture(w.o, by(A, B).id), /already been played/);
    assert.strictEqual((await play(w, last, last.teamA === C ? 1 : 0, last.teamA === C ? 0 : 1)).kind, 'OK');
    assert.strictEqual((await play(w, last, 5, 0)).kind, 'DUP', 'a fixture carries exactly one result');
    const cup = await w.core.penCup(); assert.strictEqual(cup.league.phase, 'finished'); assert.strictEqual(cup.league.champion.id, A, 'table leader is the champion with 4 teams');
    assert.deepStrictEqual(cup.standings.map(r => r.teamId), [A, B, C, D]); assert.strictEqual((await fixtures(w)).length, 6, 'no play-off fixtures with 4 teams');
    assert.strictEqual(cup.standings[0].points, 9); assert.strictEqual(cup.progress.leaguePlayed, 6);
    // friendlies never count
    assert.strictEqual((await w.store.recordPenMatch({ id: 'friendly1', teamA: D, teamB: A, goalsA: 9, goalsB: 0, result: 'A', reason: 'normal', league: false, stage: 'friendly' })).kind, 'OK');
    assert.strictEqual((await w.core.penCup()).standings[0].teamId, A);
  }

  // ---------- 6 teams: top 3 -> 2nd v 3rd semi-final, winner meets the 1st in the final ----------
  {
    const w = await mkWorld(6); const ids = w.teams.map(t => t.id);
    await w.core.admin.startPenLeague(w.o); await w.core.admin.generatePenFixtures(w.o);
    const lf = await fixtures(w, 'league'); assert.strictEqual(lf.length, 15);
    // strength = lower index wins: ids[0] 1st ... ids[5] 6th
    for (const f of lf) { const aStronger = ids.indexOf(f.teamA) < ids.indexOf(f.teamB); await play(w, f, aStronger ? 3 : 0, aStronger ? 0 : 3); }
    let cup = await w.core.penCup(); assert.strictEqual(cup.league.phase, 'playoffs'); assert.strictEqual(cup.league.champion, null);
    assert.deepStrictEqual(cup.standings.map(r => r.teamId), ids);
    const semis = await fixtures(w, 'semi'); assert.strictEqual(semis.length, 1); assert.strictEqual(Rules.pairKey(semis[0].teamA, semis[0].teamB), Rules.pairKey(ids[1], ids[2]), '2nd v 3rd');
    assert.strictEqual((await fixtures(w, 'final')).length, 0, 'no final before the semi-final is played');
    await assert.rejects(w.core.admin.deletePenFixture(w.o, semis[0].id), /cannot be deleted/);
    await w.core.admin.schedulePenFixture(w.o, semis[0].id, { scheduledAt: new Date(Date.now() + 7200e3).toISOString() });
    // 3rd place wins the semi-final -> meets the 1st (ids[0]) in the final
    await play(w, semis[0], semis[0].teamA === ids[2] ? 2 : 0, semis[0].teamA === ids[2] ? 0 : 2);
    const fin = await fixtures(w, 'final'); assert.strictEqual(fin.length, 1); assert.strictEqual(Rules.pairKey(fin[0].teamA, fin[0].teamB), Rules.pairKey(ids[0], ids[2]), '1st v semi-final winner');
    assert((await w.core.penCup(w.o)).fixtures.find(f => f.stage === 'final').roomCode, 'the final already has its room code');
    await play(w, fin[0], fin[0].teamA === ids[2] ? 1 : 0, fin[0].teamA === ids[2] ? 0 : 1);   // the semi-final winner beats the leader
    cup = await w.core.penCup(); assert.strictEqual(cup.league.phase, 'finished'); assert.strictEqual(cup.league.champion.id, ids[2], 'the final decides, not the table');
    assert.deepStrictEqual(cup.standings.map(r => r.teamId), ids, 'play-off matches never touch the league table');
  }

  // ---------- 8 teams: 1v4 and 2v3, winners meet in the final; walkover + drawn knock-out ----------
  {
    const w = await mkWorld(8); const ids = w.teams.map(t => t.id);
    await w.core.admin.startPenLeague(w.o); assert.strictEqual((await w.core.admin.generatePenFixtures(w.o)).created, 28);
    const lf = await fixtures(w, 'league'); let walked = 0;
    for (const f of lf) {
      const aStronger = ids.indexOf(f.teamA) < ids.indexOf(f.teamB);
      if (walked === 0) { walked++; await assert.rejects(w.core.admin.penWalkover(w.o, f.id, { winnerTeamId: 424242 }), /one of the two teams/); await w.core.admin.penWalkover(w.o, f.id, { winnerTeamId: aStronger ? f.teamA : f.teamB }); continue; }
      await play(w, f, aStronger ? 2 : 0, aStronger ? 0 : 2);
    }
    const wo = (await w.store.listPenMatches({})).find(m => m.reason === 'walkover'); assert(wo && wo.league === true && wo.goalsA + wo.goalsB === 3, 'walkover = 3-0 counted in the table');
    let cup = await w.core.penCup(); assert.strictEqual(cup.league.phase, 'playoffs');
    const semis = await fixtures(w, 'semi'); assert.strictEqual(semis.length, 2);
    assert.deepStrictEqual(semis.map(f => Rules.pairKey(f.teamA, f.teamB)).sort(), [Rules.pairKey(ids[0], ids[3]), Rules.pairKey(ids[1], ids[2])].sort());
    const s14 = semis.find(f => Rules.pairKey(f.teamA, f.teamB) === Rules.pairKey(ids[0], ids[3])), s23 = semis.find(f => f !== s14);
    // 1v4 ends level after 10 kicks each: the higher seed (1st) goes through; 2v3 is won by the 3rd
    await play(w, s14, 4, 4); assert.strictEqual((await fixtures(w, 'final')).length, 0, 'final waits for BOTH semi-finals');
    cup = await w.core.penCup(); assert.strictEqual(cup.fixtures.find(f => f.id === s14.id).winnerTeamId, ids[0]); assert.strictEqual(cup.fixtures.find(f => f.id === s14.id).drawn, true);
    await play(w, s23, s23.teamA === ids[2] ? 3 : 1, s23.teamA === ids[2] ? 1 : 3);
    const fin = (await fixtures(w, 'final')); assert.strictEqual(fin.length, 1); assert.strictEqual(Rules.pairKey(fin[0].teamA, fin[0].teamB), Rules.pairKey(ids[0], ids[2]));
    await w.core.admin.penWalkover(w.o, fin[0].id, { winnerTeamId: ids[2] });
    cup = await w.core.penCup(); assert.strictEqual(cup.league.phase, 'finished'); assert.strictEqual(cup.league.champion.id, ids[2]);
    assert((await w.core.admin.listAudit(w.o)).some(e => e.action === 'pen.fixture.walkover'));
  }
  // ---------- owner deletes teams: everything of them disappears; a running league needs an explicit reset ----------
  {
    const w = await mkWorld(5); const [A, B, C, D, E] = w.teams.map(t => t.id);
    await w.store.recordPenMatch({ id: 'fr-1', teamA: D, teamB: E, goalsA: 3, goalsB: 1, result: 'A', reason: 'normal', league: false, stage: 'friendly' });
    await assert.rejects(w.core.admin.deleteTeams({ ...w.teams[0].p1, role: 'PLAYER', status: 'active' }, { ids: [E], confirm: 'DELETE' }), /Owner access/);
    await assert.rejects(w.core.admin.deleteTeams(w.o, { ids: [E], confirm: 'yes' }), /Type DELETE/); await assert.rejects(w.core.admin.deleteTeams(w.o, { ids: [] , confirm: 'DELETE' }), /Select/); await assert.rejects(w.core.admin.deleteTeams(w.o, { ids: [999999], confirm: 'DELETE' }), /no longer exists/);
    // idle league: delete E (+ its friendly match) -> 4 teams left, the league can start
    assert.deepStrictEqual(await w.core.admin.deleteTeams(w.o, { ids: [E], confirm: 'DELETE' }), { ok: true, deleted: 1, leagueReset: false });
    assert.strictEqual(await w.store.getTeamById(E), null); assert.strictEqual((await w.core.penCup()).recent.length, 0, 'its matches are gone too'); assert.strictEqual((await w.core.penCup()).standings.length, 4);
    assert.strictEqual(await w.store.getActiveTeamForUser(w.teams[4].p1.id), null, 'the players are free again');
    await w.core.admin.startPenLeague(w.o); await w.core.admin.generatePenFixtures(w.o);
    const fxs = await fixtures(w); for (const f of fxs.slice(0, 2)) await play(w, f, 2, 0);
    await assert.rejects(w.core.admin.deleteTeams(w.o, { ids: [D], confirm: 'DELETE' }), e => e.code === 'LEAGUE_RESET_REQUIRED', 'a team of the running league: reset must be explicit');
    assert.strictEqual((await w.store.getTeamById(D)).id, D, 'nothing was deleted without the reset flag');
    assert.deepStrictEqual(await w.core.admin.deleteTeams(w.o, { ids: [C, D], confirm: 'DELETE', resetLeague: true }), { ok: true, deleted: 2, leagueReset: true });
    const cup = await w.core.penCup(); assert.strictEqual(cup.league.started, false); assert.strictEqual(cup.league.phase, 'idle'); assert.strictEqual((await fixtures(w)).length, 0); assert.strictEqual((await w.store.allLeaguePenMatches()).length, 0);
    assert.deepStrictEqual(cup.standings.map(r => r.teamId).sort(), [A, B].sort()); assert((await w.core.admin.listAudit(w.o)).some(e => e.action === 'team.delete'));
    await assert.rejects(w.core.admin.startPenLeague(w.o), /4, 6 or 8/, 'two teams left: not enough for a league');
  }
  console.log('pen-league ok');
})().catch(e => { console.error(e); process.exit(1); });
