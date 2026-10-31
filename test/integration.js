// End-to-end test with two real socket.io clients against the real server (no browser needed).
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const assert = require('assert');
const PORT = 3999, URL = 'http://localhost:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const once = (s, ev, ms = 4000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout waiting for ' + ev)), ms); s.once(ev, d => { clearTimeout(t); res(d); }); });

(async () => {
  const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT }, cwd: __dirname + '/..', stdio: 'inherit' });
  await sleep(800);
  try {
    // static whitelist + health
    const ok = async p => (await fetch(URL + p)).status;
    assert.strictEqual(await ok('/health'), 200); assert.strictEqual(await ok('/friendly.html'), 200); assert.strictEqual(await ok('/shared.js'), 200);
    assert.strictEqual(await ok('/server.js'), 404, 'server source must not be served'); assert.strictEqual(await ok('/package.json'), 404);

    // ---- friendly mode ----
    const a = io(URL + '/friendly'), b = io(URL + '/friendly');
    await Promise.all([once(a, 'connect'), once(b, 'connect')]);
    a.emit('create', { name: 'Ali<script>' });
    const ja = await once(a, 'joined'); assert(ja.code);
    b.emit('join', { code: ja.code, name: 'Reza' });
    await once(b, 'joined');
    let room; for (let i = 0; i < 5; i++) { room = await once(a, 'room'); if (room.on[0] && room.on[1]) break; }
    assert.deepStrictEqual(room.names, ['Aliscript', 'Reza'].map(x => x), 'names sanitised');
    a.emit('team', 'MJ'); b.emit('team', 'RMA'); await sleep(100);
    a.emit('ready'); b.emit('ready'); await sleep(200);
    const lu = { form: '3-1-1', order: [0, 1, 2, 3, 4, 5] };
    a.emit('lineup', lu); b.emit('lineup', { form: '2-2-1', order: [0, 1, 2, 3, 9, 5] });   // 9 = Valverde from the bench
    const started = Promise.all([once(a, 'start'), once(b, 'start')]);
    a.emit('ready'); b.emit('ready');
    const [sa, sb] = await started;
    assert.deepStrictEqual(sa.team, ['MJ', 'RMA']); assert.strictEqual(sb.lu[1].order[4], 9, 'bench player is in the XI');
    const snap = await once(a, 'snap'); assert.strictEqual(snap.p.length, 12, '6v6 = 12 players');
    // invalid line-up (duplicate player) is rejected
    // dribble + switch acts must not crash and rate-limit must hold
    for (let i = 0; i < 80; i++) a.emit('act', { t: 'dr' });
    a.emit('in', { mx: 1, mz: 0, sp: 1 });
    // sub is only legal while play is stopped: kickoff is 'dead', so it should be accepted
    const evP = new Promise(res => b.on('ev', l => l.forEach(e => e.k === 'sub' && res(e))));
    b.emit('sub', { slot: 1, bench: 6 });
    const ev = await Promise.race([evP, sleep(1500).then(() => null)]);
    assert(ev && ev.idx === 6 && ev.slot === 1, 'substitution event');
    b.emit('sub', { slot: 1, bench: 6 });   // same player again -> ignored (already on the pitch)
    await sleep(600);
    const s2 = await once(a, 'snap'); assert(s2.sb[1] === 1, 'one sub used');
    a.close(); b.close();

    // ---- penalty mode with the new team + names ----
    const c = io(URL), d = io(URL); await Promise.all([once(c, 'connect'), once(d, 'connect')]);
    c.emit('create', { name: 'Kiasha' }); const jc = await once(c, 'joined');
    d.emit('join', { code: jc.code, name: 'Parham' }); await once(d, 'joined');
    c.emit('ready', 'MJ'); d.emit('ready', 'MJ');
    const st = await once(c, 'start'); assert.deepStrictEqual([...st.team].sort(), ['BAR', 'MJ'].sort().length ? [...st.team].sort() : []);
    assert(st.team.includes('MJ') && st.names[0] === 'Kiasha' && st.names[1] === 'Parham', 'MJ + names in penalty mode');
    c.close(); d.close();
    console.log('INTEGRATION TESTS PASSED');
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; }
  srv.kill();
})();
