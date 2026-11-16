// Every file the penalty-cup page loads from this server must really be served (a missing route = black screen).
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'aurex-pen.html'), 'utf8');
const idx = fs.readFileSync(path.join(root, 'aurex/index.js'), 'utf8'), srv = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const PUBLIC = new Set((/const PUBLIC = new Set\(\[([^\]]*)\]/.exec(srv)[1].match(/'([^']+)'/g) || []).map(x => x.slice(1, -1)));
const routed = new Map([...idx.matchAll(/asset\('([^']+)',\s*'([^']+)'/g)].map(m => [m[1], m[2]]));
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^(https?:|\/api\/|\/aurex(#|$)|\/aurex-pen$|\/socket\.io\/)/.test(u) && !u.startsWith('/aurex#'));
const css = fs.readFileSync(path.join(root, 'aurex-pen.css'), 'utf8'); [...css.matchAll(/url\(([^)]+)\)/g)].forEach(m => refs.push(m[1].replace(/["']/g, '')));
for (const u of new Set(refs)) {
  const name = u.replace(/^\//, ''), served = routed.has('/' + name) || PUBLIC.has(name);
  assert(served, `page loads "${u}" but the server has no route for it`);
  const file = routed.get('/' + name) || name; assert(fs.existsSync(path.join(root, file)), `"${u}" is routed to missing file ${file}`);
}
['aurex-pen-3d.js', 'aurex-pen.js', 'aurex-pen.css', 'aurex-scoreboard.webp', 'aurex-pen-physics.js'].forEach(n => assert(refs.some(r => r.endsWith(n)) || n === 'aurex-pen-physics.js', n));
console.log('pen-assets ok:', [...new Set(refs)].join(', '));
