(() => {
const $ = id => document.getElementById(id);
const SQ = POF.SQUADS, KIT = { BAR: [0xa50044, 0x004d98], RMA: [0xf2f2f2, 0xf2f2f2], MJ: [0x111111, 0xd4a017] }, TEAMS = {};
POF.TEAM_KEYS.forEach(k => TEAMS[k] = { n: SQ[k].n, c: KIT[k][0], c2: KIT[k][1], r: SQ[k].r.slice(0, 6).map(p => p.n) });   // r[0] = goalkeeper, r[1..5] = penalty takers
const pname = (d, i) => (d && d.names && d.names[i]) || (i === me ? 'You' : 'Opponent');
let myTeam = 'BAR', me = -1, st = null, ph = 'idle', role = 'shooter', snd = true;
const sock = io(), keys = {};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- audio ---------- */
let ac;
function beep(f, d, type = 'sine', v = .15) {
  if (!snd) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(v, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + d);
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + d);
  } catch (e) {}
}
let cg, cf;
function crowdStart() {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); if (cg) return;
    const n = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate), d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ac.createBufferSource(); s.buffer = n; s.loop = true; cf = ac.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 600; cf.Q.value = .6;
    cg = ac.createGain(); cg.gain.value = snd ? .05 : 0; s.connect(cf); cf.connect(cg); cg.connect(ac.destination); s.start();
    let beat = 0; setInterval(() => { if (!snd) return; const p = beat++ % 8; if (p < 3 || p === 4) beep(85, .14, 'sine', .07); if (p === 5 || p === 6 || p === 7) beep(2800, .03, 'square', .015); }, 330);
  } catch (e) {}
}
function crowdSet(level, freq, dur) {
  if (!cg) return; const t = ac.currentTime;
  cg.gain.cancelScheduledValues(t); cg.gain.setValueAtTime(cg.gain.value, t); cg.gain.linearRampToValueAtTime(snd ? level : 0, t + .25); cg.gain.linearRampToValueAtTime(snd ? .05 : 0, t + dur);
  cf.frequency.cancelScheduledValues(t); cf.frequency.setValueAtTime(cf.frequency.value, t); cf.frequency.linearRampToValueAtTime(freq, t + .3); cf.frequency.linearRampToValueAtTime(600, t + dur);
}
const sfx = { whistle: () => { beep(2400, .35, 'square', .06); }, kick: () => beep(110, .15, 'triangle', .3), goal: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, .4, 'triangle'), i * 120)), save: () => beep(200, .25, 'sawtooth', .12), miss: () => beep(150, .4, 'sine', .15) };

/* ---------- three.js scene ---------- */
const canvas = $('c');
const R = new THREE.WebGLRenderer({ canvas, antialias: !(matchMedia('(pointer:coarse)').matches && (devicePixelRatio || 1) >= 2), powerPreference: 'high-performance' });
const QL = POF.Quality(R, Math.min(devicePixelRatio || 1, 2), 1);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1830); scene.fog = new THREE.Fog(0x0a1830, 45, 110);
const cam = new THREE.PerspectiveCamera(55, 1, .1, 200);
const resize = () => { R.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.fov = cam.aspect < 1 ? 70 : 55; cam.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a4a2a, .9));
const sun = new THREE.DirectionalLight(0xffffff, .8); sun.position.set(10, 40, 20); scene.add(sun);
const mat = (c, o) => new THREE.MeshLambertMaterial({ color: c, ...o });

function pitchTex() {
  const c = document.createElement('canvas'); c.width = c.height = 1024; const x = c.getContext('2d'), k = 1024 / 60;
  for (let i = 0; i < 12; i++) { x.fillStyle = i % 2 ? '#2f8f3f' : '#35a047'; x.fillRect(0, i * 1024 / 12, 1024, 1024 / 12); }
  x.strokeStyle = '#fff'; x.lineWidth = 3; const X = m => (m + 30) * k, Z = m => (m + 20) * k;
  x.strokeRect(X(-20.16), Z(-11), 40.32 * k, 16.5 * k); x.strokeRect(X(-9.16), Z(-11), 18.32 * k, 5.5 * k);
  x.beginPath(); x.moveTo(X(-30), Z(-11)); x.lineTo(X(30), Z(-11)); x.stroke();
  x.beginPath(); x.arc(X(0), Z(0), 9.15 * k, .645, Math.PI - .645); x.stroke();
  x.fillStyle = '#fff'; x.beginPath(); x.arc(X(0), Z(0), 4, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}
const pitch = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ map: pitchTex() }));
pitch.rotation.x = -Math.PI / 2; pitch.position.z = 10; scene.add(pitch);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), mat(0x1c4a24)); ground.rotation.x = -Math.PI / 2; ground.position.y = -.05; scene.add(ground);

/* goal + net */
const white = mat(0xffffff);
[-3.66, 3.66].forEach(x => { const p = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 2.44, 10), white); p.position.set(x, 1.22, -11); scene.add(p); });
const bar = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 7.32, 10), white); bar.rotation.z = Math.PI / 2; bar.position.set(0, 2.44, -11); scene.add(bar);
const netT = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); x.strokeStyle = 'rgba(255,255,255,.8)'; x.lineWidth = 2; x.strokeRect(0, 0, 32, 32); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(24, 8); return t; })();
const netM = new THREE.MeshBasicMaterial({ map: netT, transparent: true, opacity: .45, side: THREE.DoubleSide, depthWrite: false });
const netP = (w, h, x, y, z, ry, rx) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), netM); m.position.set(x, y, z); m.rotation.y = ry || 0; m.rotation.x = rx || 0; scene.add(m); };
netP(7.32, 2.44, 0, 1.22, -12.3); netP(1.3, 2.44, -3.66, 1.22, -11.65, Math.PI / 2); netP(1.3, 2.44, 3.66, 1.22, -11.65, Math.PI / 2); netP(7.32, 1.3, 0, 2.44, -11.65, 0, Math.PI / 2);

/* stands + spectators */
const specPos = [], pal = [0xa50044, 0x004d98, 0xffffff, 0xffd23f, 0xe8e8f0, 0xdd3333, 0x3366cc, 0x222222, 0x2ecc71];
const stand = (cx, cz, w, d, dx, dz) => {
  for (let k = 0; k < 9; k++) {
    const px = cx + dx * k * 1.6, pz = cz + dz * k * 1.6, h = 1.2 * (k + 1);
    const b = new THREE.Mesh(new THREE.BoxGeometry(dx ? 1.6 : w, h, dz ? 1.6 : d), mat(0x3a3f4a)); b.position.set(px, h / 2, pz); scene.add(b);
    const len = dx ? d : w, n = Math.floor(len / .75);
    for (let r = -1; r <= 1; r += 2) for (let i = 0; i < n; i++) {
      const o = -len / 2 + i * .75 + Math.random() * .2;
      specPos.push(dx ? [px + r * .4 * dx, h + .45, cz + o] : [cx + o, h + .45, pz + r * .4 * dz]);
    }
  }
};
stand(0, -21, 64, 1.6, 0, -1); stand(0, 41, 64, 1.6, 0, 1); stand(-31, 10, 1.6, 56, -1, 0); stand(31, 10, 1.6, 56, 1, 0);
const NG = 4, specGroups = [], dm = new THREE.Object3D(), skin = [0xd9a77a, 0xf1c7a0, 0x8d5a3b, 0xc68642];
for (let q = 0; q < NG; q++) {
  const grp = new THREE.Group(), pts = specPos.filter((_, i) => i % NG === q);
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(.5, .8, .4), new THREE.MeshLambertMaterial(), pts.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(.17, 6, 5), new THREE.MeshLambertMaterial(), pts.length);
  pts.forEach((p, i) => {
    dm.position.set(p[0], p[1], p[2]); dm.updateMatrix(); bodies.setMatrixAt(i, dm.matrix);
    dm.position.y += .62; dm.updateMatrix(); heads.setMatrixAt(i, dm.matrix);
    bodies.setColorAt(i, new THREE.Color(pal[Math.floor(Math.random() * pal.length)])); heads.setColorAt(i, new THREE.Color(skin[i % 4]));
  });
  grp.add(bodies, heads); scene.add(grp); specGroups.push(grp);
}
function bobSpec(t, celebrate) {
  specGroups.forEach((g, i) => { g.position.y = Math.max(0, Math.sin(t * (celebrate ? 9 : 2.2) + i * 1.7)) * (celebrate ? .45 : .06); });
}
/* floodlights */
[[-54, -42], [54, -42], [-54, 62], [54, 62]].forEach(([x, z]) => {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(.3, .4, 24, 8), mat(0x555a66)); t.position.set(x, 12, z); scene.add(t);
  const h = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 1), new THREE.MeshBasicMaterial({ color: 0xfffbe0 })); h.position.set(x, 25, z); h.lookAt(0, 10, 10); scene.add(h);
});

/* players + ball */
function person(shirt, shorts) {
  const g = new THREE.Group(), box = (w, h, d, c, y, x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x || 0, y, 0); return m; };
  const limb = (x, y, w, h, c) => { const p = new THREE.Group(); p.position.set(x, y, 0); const m = box(w, h, w, c, -h / 2); p.add(m); return p; };
  const head = new THREE.Mesh(new THREE.SphereGeometry(.14, 10, 8), mat(0xd9a77a)); head.position.y = 1.72;
  g.parts = { L: limb(-.13, .95, .18, .9, shorts), R: limb(.13, .95, .18, .9, shorts), AL: limb(-.34, 1.5, .13, .6, shirt), AR: limb(.34, 1.5, .13, .6, shirt) };
  g.add(box(.5, .65, .28, shirt, 1.25), head, g.parts.L, g.parts.R, g.parts.AL, g.parts.AR); return g;
}
const BR = .18, RUN = .5, ball = new THREE.Group(), ballFb = POF.classicBall(THREE, BR);
ball.add(ballFb); scene.add(ball);
const bshadow = new THREE.Mesh(new THREE.CircleGeometry(1, 16), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .35, depthWrite: false }));
bshadow.rotation.x = -Math.PI / 2; scene.add(bshadow);
let kicker = null, keeper = null, kx = 0, kxT = 0, dv = null, cel = null, B = { mode: 'rest' }, kickAnim = 0;
let ax = 0, ay = .35, pw = 0, charging = false;

function setupTurn(d) {
  st = d; ph = 'aim'; role = me === st.turn ? 'shooter' : 'keeper';
  [kicker, keeper].forEach(o => o && scene.remove(o));
  const tt = TEAMS[st.team[st.turn]];
  kicker = person(tt.c, tt.c2 === tt.c ? 0x14143a : tt.c2); kicker.position.set(0, 0, 3.2); scene.add(kicker);
  keeper = person(0xd7ff3a, 0x111111); keeper.position.set(0, 0, -11); scene.add(keeper);
  kx = kxT = 0; dv = null; cel = null; ax = 0; ay = .35; pw = 0; charging = false; B = { mode: 'rest' }; kickAnim = 0; ball.position.set(0, BR, 0);
  const slot = d.slot, ot = TEAMS[st.team[1 - st.turn]];
  $('taker').textContent = `${tt.r[slot % 5 + 1]}  vs  ${ot.r[0]} (GK)`;
  $('role').textContent = role === 'shooter' ? 'YOUR PENALTY — aim, hold SPACE to charge, release to shoot' : 'DEFEND — move with A / D, then dive with ← → once the ball is struck';
  $('cross').classList.toggle('hide', role !== 'shooter'); $('power').classList.toggle('hide', role !== 'shooter'); $('power').firstChild.style.width = '0';
  padRole(); hud(); sfx.whistle();
}
function padRole() {
  const s = role === 'shooter'; $('padAim').classList.toggle('hide', !s); $('shootBtn').classList.toggle('hide', !s); $('padL').classList.toggle('hide', s); $('padDive').classList.toggle('hide', s);
}
function hud() {
  if (!st) return;
  [0, 1].forEach(i => {
    { const el = $('n' + i); el.textContent = TEAMS[st.team[i]].n; const sm = document.createElement('small'); sm.textContent = pname(st, i) + (i === me ? ' (you)' : ''); el.appendChild(sm); } $('s' + i).textContent = st.score[i];
    const L = st.log[i], n = Math.max(5, L.length); $('d' + i).innerHTML = Array.from({ length: n }, (_, j) => `<i class="${L[j] === 1 ? 'g' : L[j] === 0 ? 'm' : ''}"></i>`).join('');
  });
  $('conn').textContent = st.conn[1 - me] ? '' : 'Opponent disconnected — waiting for reconnection…';
}
function banner(t, c) { const b = $('banner'); b.textContent = t; b.style.color = c; b.classList.add('show'); setTimeout(() => b.classList.remove('show'), 2200); }

/* ---------- input ---------- */
function doDive(sd, hi) {
  if (role !== 'keeper' || ph !== 'flight' || dv || (B.mode === 'fly' && B.t < -.15)) return;
  const dir = -sd; sock.emit('dive', { dir, hi, kx }); startDive(dir, hi);
}
function startDive(dir, hi) { dv = { t: 0, dir, hi, x0: kx }; }
const DIVES = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], DiveL: [-1, 0], DiveR: [1, 0], DiveHL: [-1, 1], DiveHR: [1, 1], DiveUp: [0, 1], Space: [0, 1] };
function kd(code) {
  if (keys[code]) return; keys[code] = true;
  if (role === 'keeper' && DIVES[code]) doDive(DIVES[code][0], DIVES[code][1] || !!keys.ArrowUp);
  if (role === 'shooter' && code === 'Space' && ph === 'aim') { charging = true; pw = 0; }
}
function ku(code) {
  keys[code] = false;
  if (role === 'shooter' && code === 'Space' && charging && ph === 'aim') {
    charging = false; if (pw < .05) return; ph = 'sent'; sock.emit('shoot', { ax, ay, pw });
  }
}
addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); kd(e.code); });
addEventListener('keyup', e => ku(e.code));
document.querySelectorAll('#pad button').forEach(b => {
  const c = b.dataset.k, dn = e => { e.preventDefault(); b.classList.add('p'); kd(c); }, up = e => { e.preventDefault(); b.classList.remove('p'); ku(c); };
  b.addEventListener('pointerdown', dn); ['pointerup', 'pointercancel', 'pointerleave'].forEach(n => b.addEventListener(n, up));
});

/* ---------- network ---------- */
const sess = () => JSON.parse(sessionStorage.getItem('po') || 'null');
sock.on('connect', () => { const s = sess(); if (s) sock.emit('rejoin', s); });
sock.on('err', m => { $('err').textContent = m; if (!$('menu').classList.contains('off')) return; banner(m, '#ffd23f'); });
sock.on('joined', d => {
  me = d.i; sessionStorage.setItem('po', JSON.stringify({ code: d.code, token: d.token }));
  $('home').classList.add('hide'); $('lobby').classList.remove('hide'); $('rc').textContent = d.code;
});
sock.on('room', d => {
  st = d; hud();
  [0, 1].forEach(i => { const e = $('p' + i); e.textContent = pname(d, i) + (i === me ? ' (you)' : '') + (d.conn[i] ? ' — connected' : ' — waiting…'); e.classList.toggle('on', d.conn[i]); }); lobbyUI(d);
});
sock.on('start', d => { crowdStart(); st = d; $('menu').classList.add('off'); $('hud').classList.remove('hide'); $('pad').classList.remove('hide'); hud(); });
sock.on('turn', setupTurn);
sock.on('kx', x => { kxT = x; });
sock.on('dive', d => startDive(d.dir, d.hi));
function applyShot(d, quiet = false) {
  ph = 'flight';
  const elapsed = d.t0 ? Math.max(0, (Date.now() - d.t0) / 1000) : 0;
  B = { mode: 'fly', t: quiet ? Math.min(elapsed, d.T) : -RUN, T: d.T, tx: d.tx, ty: d.ty, k: quiet ? 1 : 0 };
  kickAnim = .0001;
  if (d.dive && !dv) startDive(d.dive.dir, d.dive.hi);
  if (!quiet) sfx.whistle();
}
function applyResult(d, quiet = false) {
  ph = 'result'; st.score = d.score; st.kicks = d.kicks; st.log = d.log; hud();
  const goal = d.res === 'goal';
  if (B.mode === 'free') {
    if (goal) { B.vz = -1; B.vx *= .2; }
    else if (d.res === 'save') { B.vz = 4; B.vx = (Math.random() - .5) * 8; B.vy = 3; }
    else if (d.res === 'post') { B.vz = 5; B.vy = 2; B.vx *= -.5; }
  } else {
    B = { mode: 'rest' };
    if (d.tx != null && d.ty != null) ball.position.set(d.tx, d.ty, -11);
  }
  cel = { p: goal ? kicker : d.res === 'save' ? keeper : null, t: 0 };
  banner(goal ? 'GOAL!' : d.res === 'save' ? 'SAVED!' : d.res === 'post' ? 'OFF THE POST!' : 'MISS!', goal ? '#2ecc71' : '#e63946');
  if (!quiet) sfx[goal ? 'goal' : d.res === 'save' ? 'save' : 'miss'](); if (goal) crowdSet(.45, 1000, 4.5); else if (d.res === 'save') crowdSet(.25, 700, 3); else crowdSet(.18, 400, 2.5);
  if (goal) bobBoost = 3;
}
sock.on('shot', d => applyShot(d));
sock.on('result', d => applyResult(d));

// Rebuild the exact current match phase after a temporary disconnect or page refresh.
sock.on('sync', d => {
  st = d;
  if (d.phase === 'lobby') {
    $('menu').classList.remove('off'); $('home').classList.add('hide'); $('lobby').classList.remove('hide');
    $('hud').classList.add('hide'); $('pad').classList.add('hide'); $('rc').textContent = d.code;
    hud();
    [0, 1].forEach(i => { const e = $('p' + i); e.textContent = pname(d, i) + (i === me ? ' (you)' : '') + (d.conn[i] ? ' — connected' : ' — waiting…'); e.classList.toggle('on', d.conn[i]); }); lobbyUI(d);
    return;
  }
  if (d.phase === 'end') {
    $('menu').classList.remove('off'); $('home').classList.add('hide'); $('lobby').classList.add('hide');
    $('hud').classList.add('hide'); $('pad').classList.add('hide'); $('end').classList.remove('hide');
    $('endT').textContent = d.winner == null ? 'MATCH ENDED' : `${d.winner === me ? 'YOU WIN' : 'YOU LOSE'}  ${d.score[me]} – ${d.score[1 - me]}`;
    return;
  }
  $('menu').classList.add('off'); $('hud').classList.remove('hide'); $('pad').classList.remove('hide');
  setupTurn({ ...d, slot: d.slot == null ? d.kicks[d.turn] % 5 : d.slot });
  if (d.phase === 'idle') { ph = 'idle'; return; }
  if (d.phase === 'flight' && d.shot) {
    kx = kxT = d.kx || 0; keeper.position.x = kx;
    applyShot({ ...d.shot, dive: d.dive }, true);
  } else if (d.phase === 'result' && d.lastResult) {
    if (d.shot) ball.position.set(d.shot.tx, d.shot.ty, -11);
    B = { mode: 'rest' };
    applyResult(d.lastResult, true);
  }
});
sock.on('end', d => {
  sessionStorage.removeItem('po'); $('hud').classList.add('hide'); $('pad').classList.add('hide'); $('menu').classList.remove('off'); $('home').classList.add('hide'); $('lobby').classList.add('hide'); $('end').classList.remove('hide');
  $('endT').textContent = `${d.winner === me ? 'YOU WIN' : 'YOU LOSE'}  ${d.score[me]} – ${d.score[1 - me]}`;
});

function lobbyUI(d) {
  const both = d.conn[0] && d.conn[1], mine = d.ready && d.ready[me], opp = d.ready && d.ready[1 - me] ? d.team[1 - me] : null;
  if (opp && myTeam === opp && !mine) { myTeam = Object.keys(TEAMS).find(k => k !== opp); }
  $('lt').classList.toggle('hide', !both);
  document.querySelectorAll('.team').forEach(b => { b.classList.toggle('sel', b.dataset.t === myTeam); b.classList.toggle('off', b.dataset.t === opp || !!mine); });
  $('bReady').disabled = !both || !!mine;
  const on = pname(d, 1 - me);
  $('lmsg').textContent = !both ? 'Waiting for your opponent to join…' : mine ? 'Waiting for ' + on + ' to be ready…' : opp ? on + ' picked ' + TEAMS[opp].n + '. Choose yours, then press Ready.' : 'Both players connected. Choose your team, then press Ready.';
}
/* ---------- menu ---------- */
document.querySelectorAll('.team').forEach(b => b.onclick = () => { document.querySelectorAll('.team').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); myTeam = b.dataset.t; });
const nm = () => ({ name: POF.name() });
$('bQuick').onclick = () => { sessionStorage.removeItem('po'); sock.emit('quick', nm()); };
$('bCreate').onclick = () => { sessionStorage.removeItem('po'); sock.emit('create', nm()); };
$('bJoin').onclick = () => { sessionStorage.removeItem('po'); sock.emit('join', { code: $('code').value, ...nm() }); };
const nameBtn = () => { $('bName').textContent = 'Player: ' + POF.name() + '  ✎'; };
$('bName').onclick = () => POF.askName(true, nameBtn); POF.askName(false, nameBtn);
$('bReady').onclick = () => { sock.emit('ready', myTeam); $('bReady').disabled = true; };
$('bSound').onclick = () => { snd = !snd; if (cg) cg.gain.value = snd ? .05 : 0; $('bSound').textContent = 'Sound: ' + (snd ? 'On' : 'Off'); };
$('bFull').onclick = () => { const d = document.documentElement; document.fullscreenElement ? document.exitFullscreen() : (d.requestFullscreen || d.webkitRequestFullscreen || (() => {})).call(d); };

/* ---------- loop ---------- */
let last = performance.now(), frame = 0, bobBoost = 0, camPos = new THREE.Vector3(0, 3, 12), camLook = new THREE.Vector3(0, 1, -11), tmp = new THREE.Vector3(), lookT = new THREE.Vector3(), kxSend = 0;
function loop(now) {
  requestAnimationFrame(loop); QL.tick(now);
  const dt = Math.min((now - last) / 1000, .05); last = now; frame++;
  if (frame % 4 === 0) bobSpec(now / 1000, bobBoost > 0);
  bobBoost = Math.max(0, bobBoost - dt);
  if (kicker) {
    /* input */
    if (role === 'shooter' && ph === 'aim') {
      const s = dt * 1.1, f = (keys.KeyA || keys.KeyD) ? .5 : 1;
      if (keys.ArrowLeft) ax -= s; if (keys.ArrowRight) ax += s; if (keys.KeyA) ax -= s * .5; if (keys.KeyD) ax += s * .5;
      if (keys.ArrowUp) ay += s * .8; if (keys.ArrowDown) ay -= s * .8;
      ax = clamp(ax, -1, 1); ay = clamp(ay, 0, 1);
      if (charging) { pw = Math.min(1, pw + dt * .9); $('power').firstChild.style.width = pw * 100 + '%'; }
      kicker.position.x = ax * .4;
      tmp.set(ax * 4.5, .2 + ay * 2.8, -11).project(cam); const cr = $('cross'); cr.style.left = (tmp.x * .5 + .5) * innerWidth + 'px'; cr.style.top = (-tmp.y * .5 + .5) * innerHeight + 'px';
    }
    if (role === 'keeper' && ph !== 'result' && !dv) {
      const m = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
      if (m) { kx = clamp(kx + m * 3 * dt, -2.8, 2.8); kxSend += dt; if (kxSend > .08) { kxSend = 0; sock.emit('kx', kx); } }
      keeper.position.x = kx;
    }
    if (role === 'shooter' && !dv) { kx += (kxT - kx) * Math.min(1, dt * 12); keeper.position.x = kx; }
    /* keeper dive animation */
    if (dv) {
      dv.t = Math.min(dv.t + dt / .35, 1); const e = 1 - (1 - dv.t) * (1 - dv.t);
      keeper.position.x = dv.x0 + dv.dir * 2.6 * e; keeper.position.y = (dv.hi ? .9 : .2) * Math.sin(Math.PI * dv.t * .95);
      keeper.rotation.z = -dv.dir * 1.3 * e; keeper.parts.AL.rotation.z = -2.8 * e; keeper.parts.AR.rotation.z = 2.8 * e;
    } else if (keeper) { keeper.parts.AL.rotation.z = -.3; keeper.parts.AR.rotation.z = .3; }
    /* kick animation */
    if (B.mode === 'fly' || B.mode === 'free') {
      const tt = B.t, P = kicker.parts;
      if (tt < 0) {
        const u = (tt + RUN) / RUN, w = Math.sin(u * 11) * .9;
        kicker.position.z = 3.2 - 2.85 * u; P.L.rotation.x = w; P.R.rotation.x = -w; P.AL.rotation.x = -w * .8; P.AR.rotation.x = w * .8; kicker.rotation.x = .12;
        if (u > .8) { P.R.rotation.x = -1.1; P.L.rotation.x = .1; }
      } else {
        const kk = Math.min(tt / .09, 1); P.R.rotation.x = -1.1 + 2.7 * kk; P.L.rotation.x = .15; P.AL.rotation.x = .6; P.AR.rotation.x = -.6;
        kicker.position.z = .35 - Math.min(tt, .6) * .9; kicker.rotation.x = .12 - Math.min(tt, .5) * .2;
      }
    }
    /* celebration */
    if (cel && cel.p) { cel.t += dt; cel.p.position.y = Math.abs(Math.sin(cel.t * 6)) * .35; cel.p.parts.AL.rotation.z = -2.6; cel.p.parts.AR.rotation.z = 2.6; }
  }
  /* ball */
  if (B.mode === 'fly') {
    B.t += dt; const s = Math.max(0, Math.min(B.t / B.T, 1));
    if (!B.k && B.t >= 0) { B.k = 1; sfx.kick(); crowdSet(.14, 800, 1.6); }
    ball.position.set(B.tx * s, BR + (B.ty - BR) * s + 1.2 * s * (1 - s), -11 * s);
    if (B.t > 0) { ball.rotation.x -= dt * 14; ball.rotation.z += dt * 5; }
    if (s >= 1) { B.mode = 'free'; B.vx = B.tx / B.T * .5; B.vy = 0; B.vz = -11 / B.T * .5; }
  } else if (B.mode === 'free') {
    B.vy -= 9.8 * dt; const p = ball.position; p.x += B.vx * dt; p.y += B.vy * dt; p.z += B.vz * dt;
    if (p.y < BR) { p.y = BR; B.vy = Math.abs(B.vy) > .6 ? -B.vy * .5 : 0; B.vx *= .96; B.vz *= .96; }
    if (p.z < -12.2 && Math.abs(p.x) < 3.7 && p.y < 2.5) { p.z = -12.2; B.vz = 0; B.vx *= .3; }
    ball.rotation.x -= B.vz * dt * 2;
  }
  bshadow.position.set(ball.position.x, .02, ball.position.z); const sh = BR * (1 + ball.position.y * .25); bshadow.scale.set(sh, sh, sh); bshadow.material.opacity = Math.max(.08, .35 - ball.position.y * .12);
  /* camera */
  if (role === 'shooter') { tmp.set(kicker ? kicker.position.x * .6 : 0, 1.9, 5.6); lookT.set(B.mode === 'fly' || B.mode === 'free' ? ball.position.x * .3 : 0, 1.1, -11); }
  else { tmp.set(0, 2.4, -14.8); lookT.set(0, 1.0, 3); }
  const k = Math.min(1, dt * 3); camPos.lerp(tmp, k); camLook.lerp(lookT, k); cam.position.copy(camPos); cam.lookAt(camLook);
  R.render(scene, cam);
}
requestAnimationFrame(loop);
})();
