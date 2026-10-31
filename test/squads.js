// Data sanity for squads, ratings and formations (shared by server + both clients). Run: node test/squads.js
const assert = require('assert');
const { SQUADS, FORMS, TEAM_KEYS, ovr } = require('../shared.js');
for (const k of TEAM_KEYS) {
  const r = SQUADS[k].r;
  assert(r.length >= 6, k + ' needs at least 6 players (1 GK + 5 outfield)');
  assert(r[0].gk > 0, k + ': squad index 0 must be the goalkeeper');
  assert.strictEqual(new Set(r.map(p => p.num)).size, r.length, k + ': shirt numbers must be unique');
  assert.strictEqual(new Set(r.map(p => p.n)).size, r.length, k + ': duplicate player names');
  r.forEach(p => { for (const s of ['pac', 'sho', 'pas', 'dri', 'def']) assert(p[s] >= 1 && p[s] <= 99, `${p.n}.${s}`); assert(ovr(p) >= 1 && ovr(p) <= 99); });
}
const names = k => SQUADS[k].r.map(p => p.n);
['Kairo', 'Kalbas', 'Ryven', 'Bati', 'Ishin', 'Amir X Mod', 'Mohammad Gimer', 'Mohammad Iron', 'Parham Gameplay', 'Kiasha'].forEach(n => assert(names('MJ').includes(n), 'MJ missing ' + n));
assert.strictEqual(SQUADS.MJ.r[0].n, 'Kairo', 'Kairo is the Mashin Jadid goalkeeper');
assert.deepStrictEqual(names('MJ').slice(0, 5), ['Kairo', 'Kalbas', 'Ryven', 'Bati', 'Ishin']);
for (const [name, f] of Object.entries(FORMS)) { assert.strictEqual(f.length, 6, name); f.forEach(([x, z]) => assert(Math.abs(x) <= 1 && Math.abs(z) <= 1)); }
console.log('squads & formations OK:', TEAM_KEYS.map(k => `${k} ${SQUADS[k].r.length}`).join(', '));
