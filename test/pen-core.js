// AUREX penalty cup: rules (5 kicks, sudden death, 10v10 draw), league table, physics, AI referee / VAR.
const assert = require('assert');
const R = require('../aurex/pen-rules');
const P = require('../aurex/pen-physics');
const { judge } = require('../aurex/pen-ai');
const { C } = P;

/* ---------- rules: brute force every sequence of kicks against an independent reference implementation ---------- */
function reference(seq, first) {           // seq = array of 0/1 (miss/goal) in kick order; returns {over, winner, kicks}
  const kicks = [0, 0], goals = [0, 0];
  for (let i = 0; i < seq.length; i++) {
    const side = (first + i) % 2; kicks[side]++; goals[side] += seq[i];
    const [ka, kb] = kicks, [ga, gb] = goals;
    if (ka <= 5 && kb <= 5) {
      if (ga > gb + (5 - kb)) return { over: true, winner: 0, n: i + 1 };
      if (gb > ga + (5 - ka)) return { over: true, winner: 1, n: i + 1 };
      if (ka === 5 && kb === 5 && ga !== gb) return { over: true, winner: ga > gb ? 0 : 1, n: i + 1 };
    } else if (ka === kb && ga !== gb) return { over: true, winner: ga > gb ? 0 : 1, n: i + 1 };
    if (ka === 10 && kb === 10 && ga === gb) return { over: true, winner: null, n: i + 1 };
  }
  return { over: false };
}
let checked = 0;
for (const first of [0, 1]) for (let bits = 0; bits < (1 << 20); bits += 97) {   // sparse but varied sample of the 2^20 sequences
  const s = R.newShootout(first), seq = []; for (let i = 0; i < 20; i++) seq.push((bits >> i) & 1);
  let res = null, n = 0;
  for (const g of seq) { const side = R.shooterOf(s); assert.strictEqual(side, (first + n) % 2); res = R.applyKick(s, side, { res: g ? 'goal' : 'miss' }); n++; if (res.over) break; }
  const ref = reference(seq, first);
  assert.strictEqual(res.over, !!ref.over, 'over mismatch'); if (res.over) { assert.strictEqual(res.winner, ref.winner); assert.strictEqual(n, ref.n); }
  checked++;
}
assert(checked > 20000);
// all misses -> 10 vs 10 level -> draw after exactly 20 kicks
{ const s = R.newShootout(0); let r, n = 0; do { r = R.applyKick(s, R.shooterOf(s), { res: 'miss' }); n++; } while (!r.over); assert.strictEqual(n, 20); assert.strictEqual(r.winner, null); assert.strictEqual(r.reason, 'cap_draw'); assert.deepStrictEqual(s.kicks, [10, 10]); assert.strictEqual(R.outcomeOf(r.winner), 'DRAW'); }
// all goals -> level for ever -> draw at 10v10
{ const s = R.newShootout(1); let r, n = 0; do { r = R.applyKick(s, R.shooterOf(s), { res: 'goal' }); n++; } while (!r.over); assert.strictEqual(n, 20); assert.strictEqual(r.reason, 'cap_draw'); assert.deepStrictEqual(s.goals, [10, 10]); }
// classic early finish: 3-0 after 3 each? A scores all, B misses all -> A wins after A's 3rd goal + B's 3rd miss (6 kicks)
{ const s = R.newShootout(0); const seq = ['goal', 'miss', 'goal', 'miss', 'goal', 'miss']; let r; seq.forEach(x => { r = R.applyKick(s, R.shooterOf(s), { res: x }); }); assert(r.over && r.winner === 0 && r.reason === 'normal'); }
// sudden death: level 5-5 then A scores, B misses -> A wins in round 6 ('sudden_death')
{ const s = R.newShootout(0); for (let i = 0; i < 10; i++) R.applyKick(s, R.shooterOf(s), { res: i < 6 ? 'goal' : 'miss' }); // A:goal,goal,goal ; B:goal,goal,goal? build exact below
  const t = R.newShootout(0); let r; for (let i = 0; i < 10; i++) r = R.applyKick(t, R.shooterOf(t), { res: 'goal' }); assert(!r.over); r = R.applyKick(t, R.shooterOf(t), { res: 'goal' }); assert(!r.over, 'must finish the pair'); r = R.applyKick(t, R.shooterOf(t), { res: 'miss' }); assert(r.over && r.winner === 0 && r.reason === 'sudden_death'); }
assert.throws(() => R.applyKick(R.newShootout(0), 1, { res: 'goal' }), /wrong kicker/);
assert.deepStrictEqual(R.roundOf(R.newShootout(0), 0), { sudden: false, number: 1, of: 5 });

/* ---------- league table ---------- */
{
  const teams = [1, 2, 3, 4].map(i => ({ id: i, name: 'T' + i, teamCode: 'AX-000' + i, hasLogo: false }));
  const M = (id, a, b, ga, gb, at) => ({ id, teamA: a, teamB: b, goalsA: ga, goalsB: gb, result: ga > gb ? 'A' : gb > ga ? 'B' : 'DRAW', finishedAt: at });
  const ms = [M('m1', 1, 2, 4, 3, '2026-01-01'), M('m2', 3, 4, 2, 2, '2026-01-02'), M('m3', 1, 3, 1, 2, '2026-01-03'), M('m3', 1, 3, 1, 2, '2026-01-03') /* duplicate must be ignored */];
  const t = R.computeStandings(teams, ms);
  const by = id => t.find(r => r.teamId === id);
  assert.strictEqual(by(1).played, 2); assert.strictEqual(by(1).points, 3); assert.strictEqual(by(3).points, 4); assert.strictEqual(by(4).points, 1);
  assert.strictEqual(by(2).lost, 1); assert.strictEqual(by(1).gf, 5); assert.strictEqual(by(1).ga, 5); assert.strictEqual(by(1).gd, 0);
  assert.deepStrictEqual(t.map(r => r.teamId), [3, 1, 4, 2]); assert.deepStrictEqual(t.map(r => r.rank), [1, 2, 3, 4]);
  assert.deepStrictEqual(by(3).form, ['D', 'W']);
  assert.strictEqual(R.computeStandings(teams, []).every(r => r.points === 0 && r.played === 0), true, 'no league matches -> empty table with every team at zero');
}

/* ---------- physics ---------- */
const ZERO = () => 0.25;                 // rng that gives zero aiming error (see randn)
const shot = (inp, keeper, rng = ZERO) => { const l = P.launch(inp, rng); return P.simulate({ vel: l.vel, curve: l.curve, keeper: keeper || { x: 0, kz: 0, dive: null } }); };
// launch solver hits the aimed point (drag, gravity and curve included)
for (const [ax, ay, pw, cv] of [[0.7, 0.5, 0.5, 0], [-0.8, 0.8, 0.9, 0.7], [0.2, 0.3, 0.3, -1], [0.9, 0.9, 1, 1]]) {
  const l = P.launch({ ax, ay, pw, curve: cv }, ZERO), hit = P.freeFlightToGoalPlane(l.vel, l.curve);
  assert(Math.abs(hit.x - ax * C.HALF_W) < 0.01 && Math.abs(hit.y - ay * C.BAR_H) < 0.01, `solver miss ${ax},${ay},${pw},${cv}: ${hit.x},${hit.y}`);
}
// flight time sanity: 11 m at 14–26 m/s
{ const s = shot({ ax: 0.5, ay: 0.3, pw: 1 }); assert(s.crossing.t > 0.38 && s.crossing.t < 0.55, 'fast shot ~0.45 s'); const w = shot({ ax: 0.5, ay: 0.3, pw: 0.2 }); assert(w.crossing.t > 0.7 && w.crossing.t < 1.0, 'weak shot ~0.8 s'); }
assert.strictEqual(shot({ ax: 0.8, ay: 0.3, pw: 0.6 }).outcome, 'goal', 'corner shot past a keeper who does not move');
assert.strictEqual(shot({ ax: 1.3, ay: 0.4, pw: 0.6 }).outcome, 'miss', 'wide');
assert.strictEqual(shot({ ax: 0, ay: 1.3, pw: 0.6 }).outcome, 'miss', 'over the bar');
{ const s = shot({ ax: 1.0, ay: 0.5, pw: 0.3 }); assert.strictEqual(s.outcome, 'post'); assert(s.events.some(e => e.type === 'post')); }
{ const s = shot({ ax: 0, ay: 1.0, pw: 0.5 }); assert.strictEqual(s.outcome, 'post'); assert(s.events.some(e => e.type === 'bar')); }
{ const s = shot({ ax: 0.05, ay: 0.3, pw: 0.5 }); assert.strictEqual(s.outcome, 'save', 'shot at a standing keeper is stopped'); assert(s.keeperTouch); }
// keeper guesses right / wrong
const dive = (dir, hi, at = 0.05) => ({ x: 0, kz: 0, dive: { dir, hi, at } });
assert.strictEqual(shot({ ax: 0.7, ay: 0.25, pw: 0.35 }, dive(1, false)).outcome, 'save', 'low dive to the right saves a low right shot');
assert.strictEqual(shot({ ax: 0.7, ay: 0.25, pw: 0.35 }, dive(-1, false)).outcome, 'goal', 'wrong way = goal');
assert.strictEqual(shot({ ax: 0.6, ay: 0.9, pw: 0.5 }, dive(1, true, 0)).outcome, 'save', 'high dive covers the upper right area');
// top corner at full power cannot be reached from the middle even with a perfectly timed dive
assert.strictEqual(shot({ ax: 0.92, ay: 0.93, pw: 1 }, dive(1, true, 0)).outcome, 'goal', 'top corner at full power is unsaveable');
// a keeper who anticipates (dive during the run-up) reaches a bottom corner a late keeper cannot
assert.strictEqual(shot({ ax: 0.75, ay: 0.25, pw: 1 }, dive(1, false, 0.3)).outcome, 'goal', 'late reaction = goal');
assert.notStrictEqual(shot({ ax: 0.75, ay: 0.25, pw: 1 }, dive(1, false, -0.4)).outcome, 'goal', 'early dive reaches the corner');
assert.strictEqual(shot({ ax: 0.92, ay: 0.12, pw: 0.7 }, dive(1, false, -0.4)).outcome, 'goal', 'the very corner is out of reach from the middle');
// curve really bends the path but keeps the aimed end point
{ const a = shot({ ax: 0.5, ay: 0.4, pw: 0.5, curve: 1 }), b = shot({ ax: 0.5, ay: 0.4, pw: 0.5, curve: 0 }); const mid = s => s.samples.find(q => q[3] < 5.5)[1]; assert(Math.abs(mid(a) - mid(b)) > 0.15, 'curved ball takes another route'); assert(Math.abs(a.crossing.x - b.crossing.x) < 0.05, 'same end point'); }
// power vs accuracy: random error grows with power
{ const spread = pw => { let ss = 0; for (let i = 0; i < 400; i++) { const l = P.launch({ ax: 0, ay: 0.5, pw }, Math.random); ss += Math.pow(l.actual.x, 2); } return Math.sqrt(ss / 400); }; assert(spread(1) > spread(0.4) * 2.5, 'fast shots are less accurate'); }
// samples are well-formed and compact, and the whole thing is deterministic
{ const a = shot({ ax: 0.3, ay: 0.4, pw: 0.7 }), b = shot({ ax: 0.3, ay: 0.4, pw: 0.7 }); assert.deepStrictEqual(a.samples, b.samples); assert(a.samples.length > 20 && a.samples.length < 400); for (const q of a.samples) q.forEach(n => assert(Number.isFinite(n))); assert(JSON.stringify(a.samples).length < 12000); }
// no tunnelling through the post at full power
{ for (const ax of [0.97, 0.99, 1.0, 1.01, 1.03]) { const s = shot({ ax, ay: 0.4, pw: 1 }); assert(['post', 'goal', 'miss'].includes(s.outcome)); if (s.outcome === 'goal') assert(s.crossing.inside); } }

/* ---------- AI referee & VAR ---------- */
const sim = (o = {}) => ({ outcome: 'save', clearance: null, minZ: 3, ...o });
// clean kick -> no call, no VAR
{ const d = judge({ sim: sim({ outcome: 'goal', clearance: 0.4 }), kz: 0.1 }); assert.strictEqual(d.final, 'goal'); assert(!d.var && !d.call && !d.retake && !d.cards.length); }
// keeper clearly off the line, kick saved -> immediate call, retake, no VAR (not suspicious)
{ const d = judge({ sim: sim(), kz: 0.9 }); assert(d.retake && d.final === 'retake' && !d.var && d.call.code === 'KEEPER_OFF_LINE'); assert.deepStrictEqual(d.cards, [{ who: 'keeper', color: 'yellow' }]); }
// keeper off the line but a goal was scored -> goal stands, nothing else
{ const d = judge({ sim: sim({ outcome: 'goal', clearance: 0.3 }), kz: 0.9 }); assert(d.final === 'goal' && !d.retake && !d.cards.length && !d.var); }
// grey zone (0.25–0.55 m): VAR only when it matters
{ const d = judge({ sim: sim({ outcome: 'save' }), kz: 0.4 }); assert(d.var && d.var.reasons.includes('KEEPER_POSITION') && d.retake && d.var.verdict.code === 'KEEPER_OFF_LINE' && d.var.steps.length >= 3 && d.var.ms > 3000); assert(!d.call);
  const g = judge({ sim: sim({ outcome: 'goal', clearance: 0.3 }), kz: 0.4 }); assert(!g.var && g.final === 'goal', 'no VAR when the goal stands anyway'); }
// second caution for the keeper -> goal awarded instead of an endless retake loop
{ const d = judge({ sim: sim(), kz: 0.9, keeperYellows: 1 }); assert(d.final === 'goal' && d.awardedGoal && !d.retake && d.var === null && d.call.code === 'KEEPER_SECOND_CAUTION'); }
{ const d = judge({ sim: sim(), kz: 0.9, retakes: 2 }); assert(d.final === 'goal' && d.awardedGoal); }
// feints: legal early, VAR in the grey zone, immediate call when clearly late
{ assert(!judge({ sim: sim({ outcome: 'goal', clearance: 1 }), feintProgress: 0.4 }).var); assert.strictEqual(judge({ sim: sim({ outcome: 'goal', clearance: 1 }), feintProgress: 0.4 }).final, 'goal');
  const legalVar = judge({ sim: sim({ outcome: 'goal', clearance: 1 }), feintProgress: 0.63 }); assert(legalVar.var && legalVar.final === 'goal' && legalVar.var.verdict.code === 'CHECK_COMPLETE');
  const illegalVar = judge({ sim: sim({ outcome: 'goal', clearance: 1 }), feintProgress: 0.69 }); assert(illegalVar.var && illegalVar.final === 'miss' && illegalVar.var.verdict.code === 'ILLEGAL_FEINT' && illegalVar.cards[0].who === 'shooter');
  const clear = judge({ sim: sim({ outcome: 'goal', clearance: 1 }), feintProgress: 0.9 }); assert(!clear.var && clear.final === 'miss' && clear.call.code === 'ILLEGAL_FEINT'); }
// both infringed -> retake + two yellows
{ const d = judge({ sim: sim({ outcome: 'goal', clearance: 1 }), kz: 0.9, feintProgress: 0.9 }); assert(d.retake && d.cards.length === 2); }
// goal-line technology
{ const tight = judge({ sim: sim({ outcome: 'goal', clearance: 0.01 }) }); assert(tight.var && tight.var.verdict.code === 'GOAL_CONFIRMED' && tight.final === 'goal');
  const roomy = judge({ sim: sim({ outcome: 'goal', clearance: 0.2 }) }); assert(!roomy.var);
  const ghost = judge({ sim: sim({ outcome: 'save', minZ: -0.04 }) }); assert(ghost.var && ghost.var.verdict.code === 'NO_GOAL_LINE' && ghost.final === 'save');
  const far = judge({ sim: sim({ outcome: 'save', minZ: 0.6 }) }); assert(!far.var); }
// real simulated kicks go through the whole chain without surprises
{ let vars = 0, n = 0; for (let i = 0; i < 300; i++) { const l = P.launch({ ax: (Math.random() * 2 - 1) * 1.1, ay: Math.random() * 1.2, pw: 0.3 + Math.random() * 0.7, curve: Math.random() * 2 - 1 }); const kz = Math.random() < 0.3 ? Math.random() * 1.2 : 0.05; const r = P.simulate({ vel: l.vel, curve: l.curve, keeper: { x: (Math.random() - 0.5) * 3, kz, dive: Math.random() < 0.8 ? { dir: [-1, 0, 1][i % 3], hi: i % 2 === 0, at: Math.random() * 0.5 - 0.2 } : null } }); const d = judge({ sim: r, kz }); assert(['goal', 'save', 'post', 'miss', 'retake'].includes(d.final)); if (d.var) { vars++; assert(d.var.ms > 0 && d.var.verdict.headline); } n++; } assert(vars < n * 0.5, 'VAR is for suspicious kicks only'); }

console.log('pen-core ok (rules sequences checked:', checked + ')');
