// Unit tests for the match settings: extra time, shootout hand-off, draw fallbacks (no network).
const F = require('../friendly.js'); const assert = require('assert');
function play(set, on, score) {
  const r = F.mk('SET'); r.on = on; r.set = set; F.start(r); r.score = [...score];
  const seen = []; let guard = 0;
  while (guard++ < 30 * 200 && !['shootout', 'end'].includes(r.ph)) {
    if (r.ph === 'play' || r.ph === 'dead') r.clock = Math.min(r.clock, .02);      // run each half out instantly
    F.tick(r); for (const e of r.ev) if (e.k === 'half') seen.push(e.h); r.ev = [];
  }
  return { ph: r.ph, halves: seen, half: r.half, flip: r.flip };
}
let o = play({ night: true, extra: false, pens: false }, [true, true], [1, 1]); assert.deepStrictEqual([o.ph, o.halves], ['end', [2]], 'draw ends when extra/pens are off');
o = play({ night: true, extra: true, pens: false }, [true, true], [1, 1]); assert.deepStrictEqual([o.ph, o.halves], ['end', [2, 3, 4]], 'extra time then draw');
o = play({ night: true, extra: true, pens: true }, [true, true], [1, 1]); assert.deepStrictEqual([o.ph, o.halves], ['shootout', [2, 3, 4]], 'extra time then shootout');
o = play({ night: true, extra: false, pens: true }, [true, true], [0, 0]); assert.deepStrictEqual([o.ph, o.halves], ['shootout', [2]], 'straight to shootout');
o = play({ night: true, extra: true, pens: true }, [true, true], [2, 1]); assert.deepStrictEqual([o.ph, o.halves], ['end', [2]], 'a winner never goes to extra time');
o = play({ night: true, extra: false, pens: true }, [true, false], [1, 1]); assert.strictEqual(o.ph, 'end', 'offline player -> draw instead of shootout');
console.log('SETTINGS TESTS PASSED');
