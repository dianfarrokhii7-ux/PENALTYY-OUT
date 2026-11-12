// Long-shot odds, corner runners and the 5 s penalty wait (headless, no sockets).
const F = require('../friendly.js'); const assert = require('assert');
function fresh() { const r = F.mk('T'); r.on = [false, false]; r.sk = ['a', 'b']; F.start(r); return r; }
// 1) long shots: ~20 % of on-target long shots may score
{
  let goals = 0, N = 400;
  for (let n = 0; n < N; n++) {
    const r = fresh(); r.ph = 'play'; r.rs = null; const p = r.P[3], d = r.P[3].t === 0 ? (r.flip ? -1 : 1) : -1;
    p.x = -2 * d; p.z = 0; r.ball.x = p.x; r.ball.z = 0; r.ball.o = -1; r.ball.y = .18;
    F.shoot(r, p, .8, 0);
    for (let k = 0; k < 90 && r.ph === 'play'; k++) { F.tick(r); if (r.ev.some(e => e.k === 'goal')) { goals++; break; } r.ev = []; }
  }
  const pct = goals / N * 100; console.log('long-shot goal rate', pct.toFixed(1) + '%'); assert(pct > 8 && pct < 32, 'long shots ~20 %');
}
// 2) corner: three attackers run into the box
{
  const r = fresh(); r.ph = 'play'; F.setRestart(r, 'corner', 0, 25, 15);
  assert(r.cX && r.cX.run.length === 3 && r.cX.def.length === 3, 'corner setup');
  for (let k = 0; k < 99; k++) F.tick(r);
  const d = r.cX.d, gl = d * 25, near = r.cX.run.filter(i => Math.hypot(r.P[i].x - gl, r.P[i].z) < 10).length;
  console.log('runners in the box after 3.3s:', near); assert(near >= 2, 'attackers move to the goal');
}
// 3) penalty: no kick during the first 5 s
{
  const r = fresh(); r.on = [true, true]; r.ph = 'play'; F.setRestart(r, 'penalty', 0, 19, 0);
  F.act(r, 0, { t: 'shoot', p: .8 }); assert.strictEqual(r.pen.st, 'aim', 'cannot shoot yet');
  assert.strictEqual(F.snap(r).pn[4], 5);
  for (let k = 0; k < 30 * 5 + 3; k++) F.tick(r);
  F.act(r, 0, { t: 'shoot', p: .8 }); assert.strictEqual(r.pen.st, 'fly', 'can shoot after 5 s');
}
console.log('FEATURE TESTS PASSED');
