// Checks the dribble success rate is 40 % (+/- sampling noise) using the real simulation.
const F = require('../friendly.js');
let ok = 0, n = 0;
for (let k = 0; k < 4000; k++) {
  const r = F.mk('D'); r.on = [true, true]; F.start(r);
  const p = r.P[r.ctrl[0]]; r.ph = 'play'; r.rs = null; r.ball.o = p.i; r.inp[0] = { mx: 1, mz: 0, sp: 0 };
  F.act(r, 0, { t: 'dr' }); n++; if (p.st === 5) ok++;
}
const rate = ok / n; console.log('dribble success', (rate * 100).toFixed(1) + '%', 'of', n);
if (Math.abs(rate - .4) > .03) { console.error('rate outside 40% +/- 3%'); process.exit(1); }
