// End-to-end: a drawn friendly (short halves via env) must hand both players over to the real penalty-shootout mode.
const { spawn } = require('child_process'); const { io } = require('socket.io-client'); const assert = require('assert');
const PORT = 3998, URL = 'http://localhost:' + PORT, sleep = ms => new Promise(r => setTimeout(r, ms));
const once = (s, ev, ms = 45000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout waiting for ' + ev)), ms); s.once(ev, d => { clearTimeout(t); res(d); }); });
(async () => {
  const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, PO_HALF: '1', PO_ET: '1' }, cwd: __dirname + '/..', stdio: 'inherit' });
  await sleep(800);
  try {
    const a = io(URL + '/friendly'), b = io(URL + '/friendly'); await Promise.all([once(a, 'connect'), once(b, 'connect')]);
    a.emit('create', { name: 'Ali' }); const ja = await once(a, 'joined'); b.emit('join', { code: ja.code, name: 'Reza' }); await once(b, 'joined'); await sleep(200);
    a.emit('team', 'BAR'); b.emit('team', 'MJ'); await sleep(100); a.emit('ready'); b.emit('ready'); await sleep(200);
    a.emit('ready'); b.emit('ready'); await sleep(200);                                   // line-ups (defaults) confirmed -> settings
    a.emit('settings', { night: true, extra: true, pens: true }); await sleep(100);
    const sh = Promise.all([once(a, 'shootout'), once(b, 'shootout')]); a.emit('ready');
    const tap = setInterval(() => { a.emit('act', { t: 'pass' }); b.emit('act', { t: 'pass' }); }, 250);   // humans take the kick-offs quickly (otherwise each waits up to 9 s)
    const [ta, tb] = await sh; clearInterval(tap); assert(ta.code === tb.code && ta.token !== tb.token, 'same penalty room, different tokens');
    // join the real penalty mode exactly like a page reload does
    const c = io(URL), d = io(URL); await Promise.all([once(c, 'connect'), once(d, 'connect')]);
    const turn = once(c, 'turn'); const syn = once(c, 'sync');
    c.emit('rejoin', { code: ta.code, token: ta.token }); d.emit('rejoin', { code: tb.code, token: tb.token });
    const s = await syn, t = await turn;
    assert.deepStrictEqual(s.team, ['BAR', 'MJ']); assert.deepStrictEqual(s.names, ['Ali', 'Reza']); assert.strictEqual(t.phase, 'aim'); assert.strictEqual(t.turn, 0);
    console.log('SHOOTOUT HAND-OFF PASSED');
    [a, b, c, d].forEach(x => x.close());
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; }
  srv.kill();
})();
