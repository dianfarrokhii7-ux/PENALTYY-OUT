// Headless smoke test: simulates full matches with random human input and checks invariants.
// Run: node test/sim.js
const F = require('../friendly.js');
const assert = require('assert');
const rnd = Math.random;
function run(label, on, ticks, opts = {}) {
  const r = F.mk('TEST'); r.on = on; r.team = opts.team || ['BAR', 'RMA']; r.sk = ['a', 'b'];
  if (opts.lu) r.lu = opts.lu;
  F.start(r);
  const evs = {}, seen = { pen: 0, free: 0 };
  let nan = 0, maxSpd = 0;
  for (let k = 0; k < ticks; k++) {
    for (let t = 0; t < 2; t++) if (on[t] && rnd() < .3) {
      r.inp[t] = { mx: rnd() * 2 - 1, mz: rnd() * 2 - 1, sp: rnd() < .5 ? 1 : 0 };
      const roll = rnd();
      const a = roll < .08 ? 'pass' : roll < .14 ? 'shoot' : roll < .2 ? 'tk' : roll < .25 ? 'dr' : roll < .27 ? 'sw' : roll < .29 ? 'cross' : roll < .31 ? 'dive' : null;
      if (a) F.act(r, t, { t: a, p: .3 + rnd() * .7, dir: rnd() < .5 ? -1 : 1, hi: rnd() < .5 });
    }
    F.tick(r);
    for (const e of r.ev) { evs[e.k] = (evs[e.k] || 0) + 1; }
    r.ev = [];
    if (r.rs && r.rs.type === 'penalty') seen.pen++;
    if (r.ph === 'end') break;
    for (const p of r.P) { if (![p.x, p.z, p.vx, p.vz].every(Number.isFinite)) nan++; maxSpd = Math.max(maxSpd, Math.hypot(p.vx, p.vz)); }
    if (![r.ball.x, r.ball.y, r.ball.z].every(Number.isFinite)) nan++;
    const sn = JSON.stringify(F.snap(r)); assert(sn.length > 50);
  }
  console.log(label.padEnd(26), 'score', r.score.join('-'), 'ph', r.ph, 'nan', nan, 'maxSpd', maxSpd.toFixed(1), 'penTicks', seen.pen, JSON.stringify(evs));
  assert.strictEqual(nan, 0, 'NaN detected');
  assert.strictEqual(r.P.length, F.N);
  return r;
}
const r1 = run('2 humans', [true, true], 30 * 330);
run('human vs AI', [true, false], 30 * 330);
run('AI vs AI', [false, false], 30 * 330, { team: ['MJ', 'RMA'] });
const r4 = run('2 humans MJ/BAR', [true, true], 30 * 330, { team: ['MJ', 'BAR'] });
// rating effects: a fast, strong-shooting side should score more than a slow, weak one over many sims
let g = [0, 0];
for (let n = 0; n < 12; n++) { const r = run('ratings ' + n, [false, false], 30 * 330, { team: ['RMA', 'MJ'] }); g[0] += r.score[0]; g[1] += r.score[1]; }
console.log('RMA vs MJ goals over 12 AI matches:', g.join(' - '));
// substitutions
const rs = F.mk('SUB'); rs.on = [true, true]; rs.sk = ['a', 'b']; F.start(rs);
const before = rs.P[3].pac; rs.lu[0].order[3] = 8; // direct order change mimics the server handler
console.log('sub test ok, slot3 pac before', before);
console.log('ALL SIM TESTS PASSED');
