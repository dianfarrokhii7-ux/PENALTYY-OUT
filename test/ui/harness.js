// Browser smoke test of the match page (HUD, lobby, VAR overlay, end screen) with a fake socket and a stubbed three.js.
// Real three.js comes from a CDN in production and is not available offline, so the 3D drawing itself is not rendered here.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.join(__dirname, '..', '..'), OUT = process.argv[2] || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const FAKE_IO = `window.__emitted=[];window.io=function(){const h={};const s={on(ev,f){(h[ev]=h[ev]||[]).push(f)},emit(ev,d){window.__emitted.push([ev,d]);if(ev==='ping:t'&&typeof d==='function')d(Date.now());},close(){}};window.__fire=(ev,d)=>(h[ev]||[]).forEach(f=>f(d));setTimeout(()=>window.__fire('connect'),10);return s;};`;
const STUB = `(function(){const mk=()=>{const f=function(){};const p=new Proxy(f,{get(t,k){if(k===Symbol.toPrimitive)return()=>0;if(k==='then')return undefined;if(k==='length')return 0;return p},set(){return true},apply(){return p},construct(){return p}});return p};window.THREE=new Proxy({},{get(t,k){return k==='REVISION'?'128':mk()}});})();`;
const map = { '/aurex-pen-physics.js': 'aurex/pen-physics.js', '/aurex-pen': 'aurex-pen.html' };
const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0]; if (u === '/socket.io/socket.io.js') return res.writeHead(200, { 'content-type': 'application/javascript' }).end(FAKE_IO);
  if (u.startsWith('/api/')) return res.writeHead(404).end();
  const f = path.join(ROOT, map[u] || u.slice(1)); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404).end();
  const ext = path.extname(f), type = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type }).end(fs.readFileSync(f));
});
(async () => {
  await new Promise(r => srv.listen(0, r)); const port = srv.address().port;
  const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-'))[0];
  const browser = await chromium.launch({ executablePath: undefined, args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }), page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.goto(`http://localhost:${port}/aurex-pen`); await page.waitForTimeout(300);
  const fire = (ev, d) => page.evaluate(([e, x]) => window.__fire(e, x), [ev, d]);
  const shot = async n => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(OUT, n + '.png') }); };
  const team = (id, name, club) => ({ id, name, teamCode: 'AX-000' + id, hasLogo: false, club });
  const P0 = { userId: 1, username: 'amir_a1', on: true, ready: true, yellow: 0, team: team(1, 'Alpha FC', { id: 'barcelona', short: 'FCB', colors: ['#a50044', '#004d98'] }) };
  const P1 = { userId: 2, username: 'bita_b1', on: true, ready: true, yellow: 0, team: team(2, 'Bravo FC', { id: 'psg', short: 'PSG', colors: ['#0b2a5c', '#d8213a'] }) };
  await fire('hello', { user: { id: 1, username: 'amir_a1' }, team: P0.team, ts: Date.now() }); await shot('01-home');
  await fire('joined', { you: 0, code: 'K7QPX', room: { code: 'K7QPX', phase: 'lobby', league: false, players: [P0, null] }, ts: Date.now() }); await shot('02-lobby-wait');
  await fire('lobby', { room: { code: 'K7QPX', phase: 'lobby', league: false, players: [P0, P1] } }); await shot('03-lobby-ready');
  await fire('match:start', { matchId: 'm1', league: true, first: 0, players: [P0, P1], introMs: 10000, room: {}, ts: Date.now() }); await page.waitForTimeout(3300); await shot('04-intro-names'); await page.waitForTimeout(3300); await shot('05-intro-title');
  const log = [[], []], now = Date.now();
  await fire('turn', { k: 1, shooter: 0, keeper: 1, retake: 0, round: { sudden: false, number: 1, of: 5 }, whistleAt: now + 100, deadline: now + 25100, kicks: [0, 0], goals: [0, 0], log, first: 0, cards: [0, 0], ts: now }); await shot('06-aim-shooter');
  await page.keyboard.down('Space'); await page.waitForTimeout(700); await shot('07-charging'); await page.keyboard.up('Space');
  const emitted = await page.evaluate(() => window.__emitted.filter(e => e[0] === 'shoot')); if (emitted.length !== 1 || !(emitted[0][1].pw > 0.2)) errors.push('shoot not emitted correctly: ' + JSON.stringify(emitted));
  await fire('runup', { k: 1, runAt: Date.now(), strikeAt: Date.now() + 720, runMs: 720 }); await shot('08-runup');
  await fire('kick', { k: 1, strikeAt: Date.now() + 10, curve: 0, speed: 20, keeper: { x: 0, kz: 0 } });
  await fire('ball', { k: 1, from: 0, pts: [[0, 0, 0.11, 11], [0.1, 0.5, 0.4, 7], [0.2, 1, 0.5, 3]], ev: [{ t: 0.2, type: 'net', x: 1, y: 1 }] });
  await fire('var:start', { k: 1, reasons: ['KEEPER_POSITION'], steps: [{ text: "Checking the goalkeeper's feet at the moment of the kick", ms: 1200 }, { text: 'Measured 38 cm in front of the goal line · limit 25 cm', ms: 1300 }, { text: 'Decision confirmed', ms: 700 }], ms: 3200, measures: { keeperKz: 0.38, limit: 0.25 } }); await page.waitForTimeout(2600); await shot('09-var');
  const log2 = [[{ res: 'goal', var: false }], []];
  await fire('result', { k: 1, shooter: 0, keeper: 1, outcome: 'save', final: 'retake', retake: true, cards: [{ who: 'keeper', color: 'yellow' }], call: null, var: { reasons: ['KEEPER_POSITION'], verdict: { code: 'KEEPER_OFF_LINE', headline: 'GOALKEEPER OFF HIS LINE — SAVE CANCELLED · RETAKE', detail: 'The goalkeeper left the line before the ball was kicked. Kick retaken, goalkeeper cautioned.' } }, kicks: [0, 0], goals: [0, 0], log, first: 0, over: false, cardsTotal: [0, 1], ts: Date.now() }); await page.waitForTimeout(900); await shot('10-var-verdict-card');
  await fire('result', { k: 2, shooter: 0, keeper: 1, outcome: 'goal', final: 'goal', retake: false, cards: [], call: null, var: null, kicks: [1, 0], goals: [1, 0], log: log2, first: 0, over: false, ts: Date.now() }); await shot('11-goal');
  const log3 = [[{ res: 'goal', var: false }, { res: 'save', var: true, card: 'k' }, { res: 'goal' }, { res: 'post' }, { res: 'goal' }], [{ res: 'miss' }, { res: 'goal' }, { res: 'save' }, { res: 'goal' }, { res: 'miss' }, { res: 'goal' }]];
  await fire('turn', { k: 12, shooter: 0, keeper: 1, retake: 0, whistleAt: Date.now() + 100, deadline: Date.now() + 9000, kicks: [5, 6], goals: [3, 3], log: log3, first: 0, cards: [0, 1], ts: Date.now() }); await shot('12-sudden-death');
  await fire('end', { winner: 0, result: 'A', reason: 'sudden_death', league: true, table: [4, 3], actual: [4, 3], saved: true, kicks: [6, 6], goals: [4, 3], log: log3, first: 0, ts: Date.now() }); await page.waitForTimeout(2900); await shot('13-end');
  await browser.close(); srv.close();
  if (errors.length) { console.error('UI ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('ui smoke ok, screenshots in', OUT);
})().catch(e => { console.error(e); process.exit(1); });
