// Logic test for the browser line-up editor using a tiny DOM stub (no browser needed).
// Run: node test/lineup.js
const assert = require('assert');
global.window = global; global.POF = require('../shared.js');
const store = {}; global.localStorage = { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } };
const mkNode = () => ({ innerHTML: '', style: {}, classList: { add() {}, toggle() {} }, textContent: '', dataset: {}, handlers: {},
  addEventListener(e, f) { this.handlers[e] = f; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }), setPointerCapture() {} });
const cache = {}, el = mkNode(); el.querySelector = s => cache[s] || (cache[s] = mkNode()); el.contains = () => true;
require('../lineup.js');
const seen = []; const ed = LineupEditor.create(el, { onChange: v => seen.push(v) });
const click = data => el.handlers.click({ target: { closest: () => ({ dataset: data }) } });
const pitch = cache['.le-pitch'], tok = s => ({ dataset: { s }, style: {} });

ed.setTeam('RMA');
let v = ed.value(); assert.strictEqual(v.form, '2-2-1'); assert.deepStrictEqual(v.order, [0, 1, 2, 3, 4, 5]);
click({ a: 'auto' }); v = ed.value();
assert.strictEqual(new Set(v.order).size, 6); assert.strictEqual(v.order[0], 0);
const sq = POF.SQUADS.RMA.r, fwd = v.order[5];            // the striker slot should get a top attacker (Mbappé / Vinícius)
assert(['Kylian Mbappé', 'Vinícius Júnior'].includes(sq[fwd].n), 'auto XI puts a star striker up front, got ' + sq[fwd].n);
click({ f: '3-1-1' }); assert.strictEqual(ed.value().form, '3-1-1');
// swap two outfield slots, then bring a bench player on
click({ b: undefined, a: undefined, f: undefined }); // no-op click must not throw
const before = ed.value().order.slice();
pitch.handlers.pointerdown({ target: { closest: () => tok(1) }, clientX: 10, clientY: 10, pointerId: 1 }); pitch.handlers.pointerup({});
pitch.handlers.pointerdown({ target: { closest: () => tok(2) }, clientX: 10, clientY: 10, pointerId: 1 }); pitch.handlers.pointerup({});
const after = ed.value().order; assert.strictEqual(after[1], before[2]); assert.strictEqual(after[2], before[1]);
pitch.handlers.pointerdown({ target: { closest: () => tok(0) }, clientX: 0, clientY: 0, pointerId: 1 }); pitch.handlers.pointerup({}); // GK is locked
assert.strictEqual(ed.value().order[0], 0);
// drag turns the system into CUSTOM and clamps to the allowed area
pitch.handlers.pointerdown({ target: { closest: () => tok(5) }, clientX: 100, clientY: 100, pointerId: 1 });
pitch.handlers.pointermove({ clientX: 399, clientY: 0 }); pitch.handlers.pointerup({});
v = ed.value(); assert.strictEqual(v.form, 'custom'); assert(v.pos[5][0] <= .7 && v.pos[5][1] >= -.8);
// mirror, save slot, load slot
const z0 = v.pos[1][1]; click({ a: 'mirror' }); assert.strictEqual(ed.value().pos[1][1], -z0 || 0);
click({ a: 'mode' }); click({ slot: '0' }); assert(JSON.parse(store.pof_lineups_v1).RMA[0].form === 'custom');
click({ a: 'reset' }); assert.strictEqual(ed.value().form, '2-2-1');
click({ slot: '0' }); assert.strictEqual(ed.value().form, 'custom', 'saved line-up loads back');
// corrupted saves are rejected
store.pof_lineups_v1 = JSON.stringify({ RMA: [{ form: '2-2-1', order: [0, 1, 1, 2, 3, 4] }] });
click({ a: 'reset' }); click({ slot: '0' }); assert.strictEqual(ed.value().form, '2-2-1');
assert(seen.length > 5);
console.log('lineup editor tests passed');
