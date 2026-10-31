(() => {
const $ = id => document.getElementById(id);
const L = 25, W = 15, GW = 2.5, BR = .18;
const NS = 6, SQ = POF.SQUADS, TEAMS = {};
POF.TEAM_KEYS.forEach(k => TEAMS[k] = { n: SQ[k].n, r: SQ[k].r });
const FORMS = {
  '2-2-1': [[-.92, 0], [-.55, -.45], [-.55, .45], [-.1, -.5], [-.1, .5], [.45, 0]],
  '2-1-2': [[-.92, 0], [-.55, -.45], [-.55, .45], [-.1, 0], [.45, -.4], [.45, .4]],
  '3-1-1': [[-.92, 0], [-.55, -.6], [-.55, 0], [-.55, .6], [-.1, 0], [.45, 0]],
  '1-3-1': [[-.92, 0], [-.55, 0], [-.1, -.6], [-.1, 0], [-.1, .6], [.45, 0]],
  '1-2-2': [[-.92, 0], [-.55, 0], [-.1, -.5], [-.1, .5], [.45, -.4], [.45, .4]]
};
const DEF_FORM = '2-2-1', defOrder = () => Array.from({ length: NS }, (_, k) => k);
const lab = f => (f[0] < -.8 ? 'GK' : f[0] < -.3 ? 'DEF' : f[0] > .3 ? 'FWD' : 'MID') + (Math.abs(f[1]) > .3 ? (f[1] < 0 ? ' L' : ' R') : '');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sock = io('/friendly');
let whoE = null, me = -1, room = null, myTeam = 'BAR', snd = true, lu = { form: DEF_FORM, order: defOrder() }, sel = null, luInit = false, G = null, curLu = null, subSel = -1;

/* ---------- audio ---------- */
let ac, cg, cf;
const AC = () => { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; };
function beep(f, d, type = 'sine', v = .15) {
  if (!snd) return;
  try { const a = AC(), o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(v, a.currentTime); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + d); o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + d); } catch (e) {}
}
function crowdStart() {
  try {
    const a = AC(); if (cg) return;
    const n = a.createBuffer(1, a.sampleRate * 3, a.sampleRate), d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = a.createBufferSource(); s.buffer = n; s.loop = true; cf = a.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 600; cf.Q.value = .6;
    cg = a.createGain(); cg.gain.value = snd ? .05 : 0; s.connect(cf); cf.connect(cg); cg.connect(a.destination); s.start();
    let b = 0; setInterval(() => { if (!snd) return; const p = b++ % 8; if (p < 3 || p === 4) beep(85, .14, 'sine', .07); if (p > 4) beep(2800, .03, 'square', .015); }, 330);
  } catch (e) {}
}
function crowd(level, freq, dur) {
  if (!cg) return; const t = ac.currentTime;
  cg.gain.cancelScheduledValues(t); cg.gain.setValueAtTime(cg.gain.value, t); cg.gain.linearRampToValueAtTime(snd ? level : 0, t + .25); cg.gain.linearRampToValueAtTime(snd ? .05 : 0, t + dur);
  cf.frequency.cancelScheduledValues(t); cf.frequency.setValueAtTime(cf.frequency.value, t); cf.frequency.linearRampToValueAtTime(freq, t + .3); cf.frequency.linearRampToValueAtTime(600, t + dur);
}

/* ---------- scene ---------- */
const R = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
const MOB = matchMedia('(pointer:coarse)').matches, SH = true;
const QL = POF.Quality(R, Math.min(devicePixelRatio || 1, 2), MOB ? 1 : 1.25); R.shadowMap.enabled = SH; R.shadowMap.type = MOB ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a1830); scene.fog = new THREE.Fog(0x0a1830, 50, 120);
const cam = new THREE.PerspectiveCamera(48, 1, .1, 250);
const resize = () => { R.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.fov = cam.aspect < 1 ? 70 : 48; cam.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();
scene.add(new THREE.HemisphereLight(0xdde8ff, 0x2a4a2a, .95));
const sun = new THREE.DirectionalLight(0xffffff, .75); sun.position.set(10, 40, 15); scene.add(sun); sun.castShadow = SH;
if (SH) { sun.shadow.mapSize.set(MOB ? 1024 : 2048, MOB ? 1024 : 2048); const sc = sun.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 24; sc.bottom = -24; sc.near = 5; sc.far = 90; sun.shadow.bias = -.0006; scene.add(sun.target); }
const mat = (c, o) => new THREE.MeshLambertMaterial({ color: c, ...o });

const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.3, 'rgba(255,255,255,.4)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
(function sky() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#04091a'); g.addColorStop(.55, '#0e2347'); g.addColorStop(1, '#26456e'); x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(200, 16, 12), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.BackSide, fog: false })));
})();
(function pitch() {
  const k = 30, c = document.createElement('canvas'); c.width = 56 * k; c.height = 36 * k; const x = c.getContext('2d'), X = m => (m + 28) * k, Z = m => (m + 18) * k;
  for (let i = 0; i < 14; i++) { const gr = x.createLinearGradient(0, 0, 0, c.height); const a = i % 2 ? ['#2c8a3c', '#34a044', '#2c8a3c'] : ['#339a43', '#3fb352', '#339a43']; gr.addColorStop(0, a[0]); gr.addColorStop(.5, a[1]); gr.addColorStop(1, a[2]); x.fillStyle = gr; x.fillRect(i * c.width / 14, 0, c.width / 14 + 1, c.height); }
  for (let i = 0; i < 14000; i++) { x.fillStyle = Math.random() < .5 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.04)'; x.fillRect(Math.random() * c.width, Math.random() * c.height, 2 + Math.random() * 3, 2 + Math.random() * 3); }
  x.strokeStyle = 'rgba(255,255,255,.93)'; x.lineWidth = 4.5; x.strokeRect(X(-L), Z(-W), 2 * L * k, 2 * W * k);
  x.beginPath(); x.moveTo(X(0), Z(-W)); x.lineTo(X(0), Z(W)); x.stroke(); x.beginPath(); x.arc(X(0), Z(0), 4 * k, 0, 7); x.stroke();
  [-1, 1].forEach(s => { x.strokeRect(X(s > 0 ? L - 8 : -L), Z(-7), 8 * k, 14 * k); x.strokeRect(X(s > 0 ? L - 3 : -L), Z(-4), 3 * k, 8 * k); x.fillStyle = '#fff'; x.beginPath(); x.arc(X(s * (L - 6)), Z(0), 5, 0, 7); x.fill(); x.beginPath(); x.arc(X(s * (L - 6)), Z(0), 4 * k, s > 0 ? Math.PI - 1.0 : -1.0 + 0, s > 0 ? Math.PI + 1.0 : 1.0); x.stroke(); });
  x.fillStyle = '#fff'; x.beginPath(); x.arc(X(0), Z(0), 5, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.anisotropy = Math.min(8, R.capabilities.getMaxAnisotropy());
  const m = new THREE.Mesh(new THREE.PlaneGeometry(56, 36), new THREE.MeshLambertMaterial({ map: t, color: 0x9c9c9c })); m.rotation.x = -Math.PI / 2; m.receiveShadow = SH; scene.add(m);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(0x1c4a24)); g.rotation.x = -Math.PI / 2; g.position.y = -.05; scene.add(g);
  [-1, 1].forEach(sx => [-1, 1].forEach(sz => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1.5, 6), mat(0xffffff)); pole.position.set(sx * L, .75, sz * W); scene.add(pole);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(.35, .25), new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide })); fl.position.set(sx * L - sx * .18, 1.35, sz * W); scene.add(fl);
  }));
})();
/* goals + nets */
const netT = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.strokeStyle = 'rgba(255,255,255,.95)'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, 0); x.lineTo(64, 0); x.moveTo(0, 0); x.lineTo(0, 64); x.stroke(); x.lineWidth = 1.2; x.strokeStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.moveTo(0, 0); x.lineTo(64, 64); x.stroke(); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; })();
const netM = new THREE.MeshBasicMaterial({ map: netT, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: .05 });
function netSurf(fn, nu, nv) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const p = fn(i / nu, j / nv); pos.push(p[0], p[1], p[2]); uv.push(i, j); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const m = new THREE.Mesh(g, netM); m.frustumCulled = false; m.base = Float32Array.from(pos); scene.add(m); return m;
}
const nets = []; let ripple = null;
[-1, 1].forEach(s => {
  const gx = s * L, w = mat(0xffffff);
  [-GW, GW].forEach(z => { const p = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, 2, 10), w); p.position.set(gx, 1, z); p.castShadow = SH; scene.add(p); });
  const b = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, 2 * GW, 10), w); b.rotation.x = Math.PI / 2; b.position.set(gx, 2, 0); b.castShadow = SH; scene.add(b);
  nets.push(netSurf((u, v) => [gx + s * (1.1 + (1 - v) * 1.2), v * 2, (u - .5) * 2 * GW * (1 + (1 - v) * .08)], 20, 8));
  [-1, 1].forEach(zs => netSurf((t, v) => [gx + s * t * (1.1 + (1 - v) * 1.2), v * 2, zs * GW * (1 + t * (1 - v) * .08)], 8, 8));
  netSurf((t, u) => [gx + s * t * 1.1, 2, (u - .5) * 2 * GW], 8, 20);
  [-GW, GW].forEach(z => { const g = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 2.3, 6), w); g.rotation.z = Math.PI / 2; g.position.set(gx + s * 1.15, .03, z); scene.add(g); });
});
function startRipple() { const i = bt.x > 0 ? 1 : 0; ripple = { m: nets[i], s: i ? 1 : -1, z: bt.z, y: Math.min(bt.y, 1.8), t: 0 }; }
function netUpdate(dt) {
  if (!ripple) return; ripple.t += dt; const m = ripple.m, pos = m.geometry.attributes.position, b = m.base, t = ripple.t;
  if (t > 1.8) { pos.array.set(b); pos.needsUpdate = true; ripple = null; return; }
  const dec = Math.exp(-t * 2.2);
  for (let i = 0; i < pos.count; i++) { const dz = b[i * 3 + 2] - ripple.z, dy = b[i * 3 + 1] - ripple.y; pos.array[i * 3] = b[i * 3] + ripple.s * .8 * Math.exp(-(dz * dz + dy * dy) / 1.4) * dec * Math.sin(t * 16); }
  pos.needsUpdate = true;
}
/* ad boards */
(function () {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#0d1b2a'; x.fillRect(0, 0, 512, 64); x.fillStyle = '#ffd23f'; x.font = 'bold 40px Arial'; x.textAlign = 'center'; x.fillText('PENALTY OUT', 256, 46);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(5, 1);
  [-1, 1].forEach(s => { const m = new THREE.Mesh(new THREE.BoxGeometry(2 * L + 6, .9, .15), new THREE.MeshBasicMaterial({ map: t })); m.position.set(0, .45, s * (W + 1.8)); scene.add(m); });
  const t2 = t.clone(); t2.needsUpdate = true; t2.repeat.set(3, 1);
  [-1, 1].forEach(s => { const m = new THREE.Mesh(new THREE.BoxGeometry(.15, .9, 2 * W + 3.6), new THREE.MeshBasicMaterial({ map: t2 })); m.position.set(s * (L + 3.5), .45, 0); scene.add(m); });
})();
/* stands + crowd */
const sp = [], pal = [0xa50044, 0x004d98, 0xffffff, 0xffd23f, 0xe8e8f0, 0xdd3333, 0x3366cc, 0x222222, 0x2ecc71];
function stand(cx, cz, len, alongX, dx, dz) {
  for (let k = 0; k < 8; k++) {
    const px = cx + dx * k * 1.6, pz = cz + dz * k * 1.6, h = 1.2 * (k + 1);
    const b = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 1.6, h, alongX ? 1.6 : len), mat(0x3a3f4a)); b.position.set(px, h / 2, pz); scene.add(b);
    const n = Math.floor(len / .8);
    for (let r = -1; r <= 1; r += 2) for (let i = 0; i < n; i++) { const o = -len / 2 + i * .8 + Math.random() * .2; sp.push(alongX ? [cx + o, h + .45, pz + r * .4 * dz] : [px + r * .4 * dx, h + .45, cz + o]); }
  }
}
stand(0, W + 5, 2 * L + 10, true, 0, 1); stand(0, -W - 5, 2 * L + 10, true, 0, -1); stand(L + 6, 0, 2 * W + 12, false, 1, 0); stand(-L - 6, 0, 2 * W + 12, false, -1, 0);
const groups = [], dm = new THREE.Object3D();
for (let q = 0; q < 4; q++) {
  const pts = sp.filter((_, i) => i % 4 === q), g = new THREE.Group();
  const bd = new THREE.InstancedMesh(new THREE.BoxGeometry(.5, .8, .4), new THREE.MeshLambertMaterial(), pts.length), hd = new THREE.InstancedMesh(new THREE.SphereGeometry(.17, 6, 5), new THREE.MeshLambertMaterial(), pts.length);
  pts.forEach((p, i) => { dm.position.set(p[0], p[1], p[2]); dm.updateMatrix(); bd.setMatrixAt(i, dm.matrix); dm.position.y += .62; dm.updateMatrix(); hd.setMatrixAt(i, dm.matrix); bd.setColorAt(i, new THREE.Color(pal[Math.floor(Math.random() * pal.length)])); hd.setColorAt(i, new THREE.Color([0xd9a77a, 0xf1c7a0, 0x8d5a3b, 0xc68642][i % 4])); });
  g.add(bd, hd); scene.add(g); groups.push(g);
}
[[-40, -28], [40, -28], [-40, 28], [40, 28]].forEach(([x, z]) => {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(.3, .4, 22, 8), mat(0x555a66)); t.position.set(x * 1.2, 11, z * 1.2); scene.add(t);
  const h = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 1), new THREE.MeshBasicMaterial({ color: 0xfffbe0 })); h.position.set(x * 1.2, 23, z * 1.2); h.lookAt(0, 8, 0); scene.add(h); const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff2c8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); gl.position.copy(h.position); gl.scale.set(16, 16, 1); scene.add(gl);
});

/* ball */
const ball = new THREE.Group(), ballFb = POF.classicBall(THREE, BR); ballFb.castShadow = SH; ball.add(ballFb); scene.add(ball);
const bsh = new THREE.Mesh(new THREE.CircleGeometry(1, 14), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .35, depthWrite: false })); bsh.rotation.x = -Math.PI / 2; bsh.visible = !SH; scene.add(bsh);

/* ---------- players ---------- */
function kitTex(team, num, gk) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d');
  if (gk) { x.fillStyle = '#c8f031'; x.fillRect(0, 0, 256, 128); x.fillStyle = '#1a1a1a'; for (let i = 0; i < 256; i += 32) x.fillRect(i, 0, 6, 128); }
  else if (team === 'MJ') { x.fillStyle = '#111'; x.fillRect(0, 0, 256, 128); x.fillStyle = '#d4a017'; for (let i = 0; i < 256; i += 16) x.fillRect(i, 0, 2, 128); x.fillRect(0, 0, 256, 6); }
  else if (team === 'BAR') for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#004d98' : '#a50044'; x.fillRect(i * 32, 0, 32, 128); }
  else { x.fillStyle = '#f6f6fa'; x.fillRect(0, 0, 256, 128); x.fillStyle = '#d8c06a'; x.fillRect(0, 0, 256, 5); x.fillStyle = '#e4e4ee'; for (let i = 0; i < 256; i += 16) x.fillRect(i, 5, 8, 123); }
  x.fillStyle = gk || team === 'RMA' ? '#222' : '#ffd23f'; x.font = 'bold 58px Arial'; x.textAlign = 'center'; x.fillText(num, 128, 80);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}
function makePlayer(team, num, gk) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const skin = [0xd9a77a, 0xf1c7a0, 0x8d5a3b, 0xc68642][num % 4], K = { BAR: [0x1a2a6c, 0xa50044, 0xa50044], RMA: [0xf2f2f6, 0xf6f6fa, 0xf6f6fa], MJ: [0x111111, 0xd4a017, 0x151515] }[team];
  const shorts = gk ? 0x111111 : K[0], sock = gk ? 0xc8f031 : K[1], sleeve = gk ? 0xc8f031 : K[2];
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(.25, .2, .64, 14), new THREE.MeshLambertMaterial({ map: kitTex(team, num, gk) })); torso.scale.z = .62; torso.position.y = 1.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.125, 12, 10), mat(skin)); head.position.y = 1.7;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.135, 12, 6, 0, Math.PI * 2, 0, Math.PI * .55), mat([0x1a1208, 0x3a2512, 0x111111, 0x7a5a2a][num % 4])); hair.position.y = 1.71; hair.rotation.x = -.25;
  const eyes = new THREE.Mesh(new THREE.BoxGeometry(.13, .02, .02), mat(0x111111)); eyes.position.set(0, 1.72, .115);
  body.add(torso, head, hair, eyes);
  const leg = x => {
    const hip = new THREE.Group(); hip.position.set(x, .95, 0);
    const th = new THREE.Mesh(new THREE.CylinderGeometry(.095, .078, .46, 8), mat(shorts)); th.position.y = -.23;
    const kn = new THREE.Group(); kn.position.y = -.46;
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(.065, .05, .46, 8), mat(sock)); sh.position.y = -.23;
    const bt = new THREE.Mesh(new THREE.BoxGeometry(.11, .07, .26), mat(0x151515)); bt.position.set(0, -.48, .06);
    kn.add(sh, bt); hip.add(th, kn); hip.kn = kn; return hip;
  };
  const arm = x => {
    const s = new THREE.Group(); s.position.set(x, 1.5, 0);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(.06, .055, .3, 8), mat(sleeve)); up.position.y = -.15;
    const el = new THREE.Group(); el.position.y = -.3; const lo = new THREE.Mesh(new THREE.CylinderGeometry(.05, .04, .28, 8), mat(skin)); lo.position.y = -.14;
    const hd = new THREE.Mesh(new THREE.SphereGeometry(.05, 6, 5), mat(gk ? 0xffffff : skin)); hd.position.y = -.3;
    el.add(lo, hd); s.add(up, el); s.el = el; return s;
  };
  const hl = leg(-.1), hr = leg(.1), al = arm(-.3), ar = arm(.3); body.add(hl, hr, al, ar);
  g.p = { body, hl, hr, al, ar }; return g;
}
const shadowGeo = new THREE.CircleGeometry(.45, 12), ring = new THREE.Mesh(new THREE.RingGeometry(.55, .68, 24), new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide, transparent: true, opacity: .9 }));
ring.rotation.x = -Math.PI / 2; ring.position.y = .03; scene.add(ring);
const arrow = new THREE.Mesh(new THREE.ConeGeometry(.16, .32, 8), new THREE.MeshBasicMaterial({ color: 0xffd23f })); arrow.rotation.x = Math.PI; scene.add(arrow);
let ents = [];
function mkEnt(team, luA, t, s, old) {
  const key = team[t], q = TEAMS[key].r[luA[t].order[s]], g = makePlayer(key, q.num, s === 0);
  const sh = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .3, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = .02;
  g.traverse(o => { if (o.isMesh) o.castShadow = SH; }); scene.add(g, sh);
  const e = { g, sh, t, s, q, name: q.n, num: q.num, x: 0, z: 0, a: 0, tx: 0, tz: 0, ta: 0, st: 0, red: 0, sp: 0, ph: Math.random() * 6, kt: 0, pst: 0, d5: 0 };
  if (old) { Object.assign(e, { x: old.x, z: old.z, a: old.a, tx: old.tx, tz: old.tz, ta: old.ta, st: old.st, red: old.red }); scene.remove(old.g); scene.remove(old.sh); }
  return e;
}
function buildPlayers(team, luA) {
  ents.forEach(e => { scene.remove(e.g); scene.remove(e.sh); }); ents = []; curLu = JSON.parse(JSON.stringify(luA));
  for (let t = 0; t < 2; t++) for (let s = 0; s < NS; s++) ents.push(mkEnt(team, curLu, t, s));
}
function animate(e, dt, B, celeb) {
  const P = e.g.p, k = Math.min(1, e.sp / 6.5); e.ph += dt * (2 + e.sp * 1.45); const s = Math.sin(e.ph), c = Math.cos(e.ph);
  P.hl.rotation.x = -s * .85 * k; P.hr.rotation.x = s * .85 * k; P.hl.kn.rotation.x = Math.max(0, -c) * 1.1 * k; P.hr.kn.rotation.x = Math.max(0, c) * 1.1 * k;
  P.al.rotation.x = s * .7 * k; P.ar.rotation.x = -s * .7 * k; P.al.el.rotation.x = P.ar.el.rotation.x = -.25 - .5 * k; P.al.rotation.z = P.ar.rotation.z = 0;
  P.body.rotation.x = .04 + k * .18; P.body.position.y = Math.abs(s) * .05 * k + Math.sin(e.ph * .3) * .005; e.g.position.y = 0; e.g.rotation.x = 0; P.body.rotation.z = 0;
  if (e.st === 1) { e.g.position.y = .12; P.body.rotation.x = -1.35; P.hr.rotation.x = -1.5; P.hl.rotation.x = .3; P.hr.kn.rotation.x = 0; P.al.rotation.z = -1.2; P.ar.rotation.z = 1.2; }
  else if (e.st === 2 || e.kt > 0) {
    if (e.st === 2 && e.pst !== 2) e.kt = .25; e.kt = Math.max(0, e.kt - dt); const u = 1 - e.kt / .25;
    P.hr.rotation.x = u < .35 ? .9 * (u / .35) : .9 - 2.4 * ((u - .35) / .65); P.hr.kn.rotation.x = u < .35 ? .8 : 0; P.al.rotation.z = -.7; P.ar.rotation.z = .7;
  }
  if (e.s === 0 && Math.hypot(B.x - e.x, B.z - e.z) < 2.8 && B.y > .35) { P.al.rotation.z = -2.5; P.ar.rotation.z = 2.5; P.al.rotation.x = P.ar.rotation.x = -.3; P.body.rotation.z = clamp((B.z - e.z) * .1, -.4, .4) * Math.sign(Math.cos(e.a) || 1); }
  if (e.st === 4) { e.g.position.y = .45; P.body.rotation.x = -.25; P.al.rotation.z = -1.2; P.ar.rotation.z = 1.2; P.hl.rotation.x = .3; P.hr.rotation.x = -.3; }
  if (e.st === 3) { const sg = Math.sign(e.vz || 0), lx = -Math.sin(e.g.rotation.y) * sg; e.g.position.y = .35; P.body.rotation.z = -(Math.sign(lx) || 1) * 1.25 * (sg ? 1 : 0); P.al.rotation.z = -2.6; P.ar.rotation.z = 2.6; }
  if (e.st === 5) { e.d5 += dt; const w = Math.sin(e.d5 * 20); P.body.rotation.z = w * .5; P.body.rotation.x = .3; P.hl.rotation.x = w * 1.1; P.hr.rotation.x = -w * 1.1; P.al.rotation.z = -.9; P.ar.rotation.z = .9; } else e.d5 = 0;
  if (e.st === 6) { e.g.position.y = .05; P.body.rotation.x = .7; P.al.rotation.z = -1.4; P.ar.rotation.z = 1.4; P.hl.rotation.x = .5; P.hr.rotation.x = -.7; }
  if (celeb === e.t) { e.g.position.y = Math.abs(Math.sin(e.ph * 2)) * .35; P.al.rotation.z = -2.6; P.ar.rotation.z = 2.6; }
  e.pst = e.st;
}

/* ---------- game state / input ---------- */
const Bl = { x: 0, y: BR, z: 0, o: -1 }, bt = { x: 0, y: BR, z: 0 };
let S = null, flip = 0, celeb = -1, celebT = 0, camPos = new THREE.Vector3(0, 18, 24), camLook = new THREE.Vector3(), dmCur = 1, tmpV = new THREE.Vector3();
const keys = {}, inp = { sx: 0, sy: 0, sp: 0 }; let joy = { x: 0, y: 0 }, spBtn = false, chargeT = 0, lastSent = '', lastSendAt = 0;
const act = (t, p, x) => sock.emit('act', { t, p, ...x });
function startCharge() { if (!chargeT) chargeT = performance.now(); }
function release() { if (!chargeT) return; const p = clamp((performance.now() - chargeT) / 900, .25, 1); chargeT = 0; $('power').firstChild.style.width = '0'; act('shoot', p); }
function stick() {
  let sx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x, sy = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + joy.y;
  const n = Math.hypot(sx, sy); if (n > 1) { sx /= n; sy /= n; } return [sx, sy];
}
function camMode() {
  if (!S || !S.rs || S.ph !== 'dead') return { m: 'b' };
  if (S.rs.k === 'penalty' && S.pn) { const d = S.pn[3]; if (S.rs.t === me) return S.pn[0] === 0 ? { m: 'pk', d } : { m: 'b' }; return { m: 'pg', d }; }
  if (S.rs.k === 'freekick' && S.rs.t === me && S.k[me] === S.rs.tk) return { m: 'fk' };
  return { m: 'b' };
}
function press(a) {
  if (S && S.rs && S.rs.k === 'penalty' && S.pn && S.rs.t !== me) { if (a === 'shoot' || a === 'pass') { const [sx, sy] = stick(); act('dive', 0, { dir: sx > .3 ? 1 : sx < -.3 ? -1 : 0, hi: sy > .3 }); } return; }
  if (a === 'pass') act('pass'); else if (a === 'cross') act('cross'); else if (a === 'tk') act('tk'); else if (a === 'dr') act('dr'); else if (a === 'sw') act('sw'); else if (a === 'shoot') startCharge(); else if (a === 'sprint') spBtn = true; }
function unpress(a) { if (a === 'shoot') release(); else if (a === 'sprint') spBtn = false; }
const KM = { KeyR: 'dr', KeyI: 'dr', KeyE: 'cross', KeyU: 'cross', KeyF: 'pass', KeyJ: 'pass', Space: 'shoot', KeyK: 'shoot', KeyC: 'tk', KeyL: 'tk', KeyV: 'sw', Tab: 'sw' };
addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; if (KM[e.code] || e.code.startsWith('Arrow')) e.preventDefault(); if (e.repeat) return; keys[e.code] = 1; if (e.code === 'KeyB') toggleSubs(); if (KM[e.code]) press(KM[e.code]); });
addEventListener('keyup', e => { keys[e.code] = 0; if (KM[e.code]) unpress(KM[e.code]); });
document.querySelectorAll('#fb button').forEach(b => { const a = b.dataset.a; b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('p'); press(a); }); ['pointerup', 'pointercancel', 'pointerleave'].forEach(n => b.addEventListener(n, e => { e.preventDefault(); if (b.classList.contains('p')) { b.classList.remove('p'); unpress(a); } })); });
const joyEl = $('joy'), knob = $('knob');
function joyMove(e) { const r = joyEl.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), n = Math.hypot(dx, dy) || 1, m = Math.min(n, 55); joy.x = dx / n * m / 55; joy.y = -dy / n * m / 55; knob.style.transform = `translate(${dx / n * m}px,${dy / n * m}px)`; }
joyEl.addEventListener('pointerdown', e => { e.preventDefault(); joyEl.setPointerCapture(e.pointerId); joyMove(e); });
joyEl.addEventListener('pointermove', e => { if (e.buttons || e.pressure) joyMove(e); });
['pointerup', 'pointercancel'].forEach(n => joyEl.addEventListener(n, () => { joy = { x: 0, y: 0 }; knob.style.transform = ''; }));
function sendInput(now, dmv, cm) {
  const [sx, sy] = stick(); let mx, mz;
  if (cm.m === 'pk' || cm.m === 'pg') { mx = sx; mz = sy; } else if (cm.m === 'fk') { mx = dmv * sy; mz = dmv * sx; } else { mx = dmv * sx; mz = -dmv * sy; }
  const d = { mx: +mx.toFixed(2), mz: +mz.toFixed(2), sp: keys.ShiftLeft || keys.ShiftRight || spBtn ? 1 : 0 }, j = JSON.stringify(d);
  if (j !== lastSent || now - lastSendAt > 300) { lastSent = j; lastSendAt = now; sock.emit('in', d); }
}

/* ---------- network ---------- */
const banner = (t, c) => { const b = $('banner'); b.textContent = t; b.style.color = c || '#f4f0e6'; b.classList.add('show'); clearTimeout(banner.t); banner.t = setTimeout(() => b.classList.remove('show'), 2000); };
const RS = { kickoff: 'KICK-OFF', throwin: 'THROW-IN', goalkick: 'GOAL KICK', corner: 'CORNER', freekick: 'FREE KICK', penalty: 'PENALTY' };
sock.on('connect', () => { const s = JSON.parse(sessionStorage.getItem('pof') || 'null'); if (s) sock.emit('rejoin', s); });
sock.on('err', m => { $('err').textContent = m; if ($('menu').classList.contains('off')) banner(m, '#ffd23f'); });
sock.on('joined', d => { me = d.i; sessionStorage.setItem('pof', JSON.stringify({ code: d.code, token: d.token })); show('lobby'); $('rc').textContent = d.code; });
function show(id) { ['home', 'lobby', 'lineup', 'end'].forEach(s => $(s).classList.toggle('hide', s !== id)); }
sock.on('room', d => {
  room = d; if (me < 0) return;
  [0, 1].forEach(i => { const e = $('p' + i), nm = (d.names && d.names[i]) || (i === me ? 'You' : 'Opponent'); e.textContent = nm + (i === me ? ' (you)' : '') + (d.on[i] ? ' — connected' : ' — waiting…'); e.classList.toggle('on', d.on[i]); });
  if (d.ph === 'lineup') { if (!luInit) { luInit = true; lu = { form: DEF_FORM, order: defOrder() }; sel = null; show('lineup'); renderLU(); } $('lumsg').textContent = d.rdy[me] ? 'Waiting for opponent…' : ''; $('bStart').disabled = !!d.rdy[me]; return; }
  if (d.ph !== 'lobby') return;
  const both = d.on[0] && d.on[1], mine = d.rdy[me], opp = d.rdy[1 - me] ? d.team[1 - me] : null;
  if (opp && myTeam === opp && !mine) { myTeam = Object.keys(TEAMS).find(k => k !== opp); sock.emit('team', myTeam); }
  $('lt').classList.toggle('hide', !both);
  document.querySelectorAll('.team').forEach(b => { b.classList.toggle('sel', b.dataset.t === myTeam); b.classList.toggle('off', b.dataset.t === opp || !!mine); });
  $('bReady').disabled = !both || !!mine;
  const on = (d.names && d.names[1 - me]) || 'Opponent';
  $('lmsg').textContent = !both ? 'Waiting for your opponent to join…' : mine ? 'Waiting for ' + on + '…' : opp ? on + ' picked ' + TEAMS[opp].n + '. Choose yours and press Ready.' : 'Both connected. Choose your team and press Ready.';
});
const getF = l => l.form === 'custom' ? l.pos : FORMS[l.form];
function drawPrev() { $('prev').innerHTML = getF(lu).map((f, i) => `<i class="${i ? '' : 'gk'}" style="left:${(f[0] + 1) / 2 * 100}%;top:${(f[1] + 1) / 2 * 100}%">${i ? i : 'GK'}</i>`).join(''); }
const statLine = q => q.gk ? `GK ${q.gk}` : `PAC ${q.pac} · SHO ${q.sho} · PAS ${q.pas} · DRI ${q.dri} · DEF ${q.def}`;
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderLU() {
  const my = room ? room.team[me] : myTeam, F = getF(lu), sq = SQ[my].r, used = new Set(lu.order);
  $('forms').innerHTML = Object.keys(FORMS).concat('custom').map(f => `<button data-f="${f}" class="${f === lu.form ? 'sel' : ''}">${f === 'custom' ? 'CUSTOM' : f}</button>`).join('');
  $('slots').innerHTML = F.map((f, i) => { const q = sq[lu.order[i]]; return `<div class="srow"><button data-s="${i}" class="${sel && sel.k === 's' && sel.i === i ? 'sel' : ''} ${i === 0 ? 'lock' : ''}"><span>${lab(f)}</span><span>${esc(q.n)} #${q.num}</span><b class="ov">${POF.ovr(q)}</b></button><small class="stl">${statLine(q)}</small>${lu.form === 'custom' && i ? `<span class="sl"><input type="range" data-s="${i}" data-k="0" min="-80" max="70" value="${Math.round(f[0] * 100)}"><input type="range" data-s="${i}" data-k="1" min="-80" max="80" value="${Math.round(f[1] * 100)}"></span>` : ''}</div>`; }).join('');
  $('bench').innerHTML = sq.map((q, i) => i && !used.has(i) ? `<button data-b="${i}" class="${sel && sel.k === 'b' && sel.i === i ? 'sel' : ''}"><span>${esc(q.n)} #${q.num}</span><b class="ov">${POF.ovr(q)}</b><small class="stl">${statLine(q)}</small></button>` : '').join('') || '<p class="sub">No bench players</p>';
  drawPrev();
  document.querySelectorAll('#forms button').forEach(b => b.onclick = () => {
    if (b.dataset.f === 'custom') { if (lu.form !== 'custom') lu.pos = FORMS[lu.form].map(q => q.slice()); lu.form = 'custom'; } else { lu.form = b.dataset.f; delete lu.pos; }
    sock.emit('lineup', lu); renderLU();
  });
  const pick = (k, i) => {   // tap a slot / bench player, then another: swap two slots, or bring a bench player on
    if (!sel || sel.k === k && k === 'b') { sel = sel && sel.i === i ? null : { k, i }; return renderLU(); }
    if (sel.k === 's' && k === 's') { if (sel.i !== i) { const o = lu.order; [o[sel.i], o[i]] = [o[i], o[sel.i]]; } }
    else if (sel.k !== k) { const si = k === 's' ? i : sel.i, bi = k === 'b' ? i : sel.i; lu.order[si] = bi; }
    sel = null; sock.emit('lineup', lu); renderLU();
  };
  document.querySelectorAll('#slots button').forEach(b => b.onclick = () => { const i = +b.dataset.s; if (i === 0) return; pick('s', i); });
  document.querySelectorAll('#bench button').forEach(b => b.onclick = () => pick('b', +b.dataset.b));
  document.querySelectorAll('#slots input').forEach(inp => { inp.oninput = () => { lu.pos[+inp.dataset.s][+inp.dataset.k] = inp.value / 100; drawPrev(); }; inp.onchange = () => sock.emit('lineup', lu); });
}
$('bStart').onclick = () => { sock.emit('lineup', lu); sock.emit('ready'); $('bStart').disabled = true; };
sock.on('start', d => {
  room = { ...(room || {}), team: d.team }; buildPlayers(d.team, d.lu); G = d;
  $('menu').classList.add('off'); $('hud').classList.remove('hide'); if (matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window) { $('fpad').classList.remove('hide'); $('help').classList.add('hide'); }
  [0, 1].forEach(i => { const el = $('n' + i), nm = (room && room.names && room.names[i]) || ''; el.textContent = TEAMS[d.team[i]].n; if (nm) { const sm = document.createElement('small'); sm.textContent = nm + (i === me ? ' (you)' : ''); el.appendChild(sm); } });
  $('bSubs').classList.remove('hide'); crowdStart();
});
sock.on('snap', s => {
  S = s; flip = s.fl; Bl.o = s.b[3]; bt.x = s.b[0]; bt.y = s.b[1]; bt.z = s.b[2];
  s.p.forEach((p, i) => { const e = ents[i]; if (!e) return; e.tx = p[0]; e.tz = p[1]; e.ta = p[2]; e.st = p[3]; e.red = p[4]; e.sp = p[5]; e.vz = p[7] || 0; });
  $('s0').textContent = s.s[0]; $('s1').textContent = s.s[1]; $('clk').textContent = `${s.h === 1 ? '1st' : '2nd'}  ${Math.floor(s.c / 60)}:${String(s.c % 60).padStart(2, '0')}`;
  const ce = ents[s.k[me]]; if (ce && ce !== whoE) { whoE = ce; $('who').innerHTML = `${esc(ce.name)} #${ce.num} <b>${POF.ovr(ce.q)}</b><small>${statLine(ce.q)}</small>`; } else if (!ce) $('who').textContent = '';
  subRefresh(s);
  $('msg').textContent = s.ph === 'dead' && s.rs ? (s.rs.k === 'penalty' ? (s.rs.t === me ? (s.pn && s.pn[0] === 0 ? 'PENALTY — aim with stick / WASD, hold SHOOT, release to kick' : '') : 'PENALTY — you are the goalkeeper: move left/right, press SHOOT to dive toward the stick') : `${RS[s.rs.k]} — ${s.rs.t === me ? 'YOU (pass / shoot)' : 'opponent'}`) : '';
  if (chargeT) $('power').firstChild.style.width = clamp((performance.now() - chargeT) / 900, 0, 1) * 100 + '%';
  if (room && room.on) $('conn').textContent = room.on[1 - me] ? '' : 'Opponent disconnected — AI is playing for them';
});
sock.on('ev', list => list.forEach(e => {
  if (e.k === 'kick') { beep(110, .15, 'triangle', .3); crowd(.1, 800, 1.2); }
  else if (e.k === 'tackle') beep(160, .12, 'sawtooth', .1);
  else if (e.k === 'save') { beep(200, .25, 'sawtooth', .12); crowd(.22, 700, 2.5); }
  else if (e.k === 'win') beep(240, .1, 'triangle', .12);
  else if (e.k === 'restart') { beep(2400, .25, 'square', .05); if (e.type !== 'kickoff') banner(RS[e.type]); }
  else if (e.k === 'goal') { startRipple(); celeb = e.t; celebT = 3.2; banner(e.t === me ? 'GOAL!' : 'GOAL FOR OPPONENT', e.t === me ? '#2ecc71' : '#e63946'); [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, .4, 'triangle'), i * 120)); crowd(.45, 1000, 4.5); }
  else if (e.k === 'foul') { beep(2400, .5, 'square', .06); banner(e.card === 'r' ? 'RED CARD' : e.card === 'y' ? 'YELLOW CARD' : e.pen ? 'FOUL — PENALTY' : 'FOUL', e.card === 'r' ? '#e63946' : '#ffd23f'); crowd(.2, 450, 2.5); }
  else if (e.k === 'penres') { if (e.res !== 'goal') banner(e.res === 'save' ? 'SAVED!' : e.res === 'post' ? 'OFF THE POST!' : 'MISSED!', '#e63946'); }
  else if (e.k === 'dribble') { beep(e.ok ? 660 : 130, e.ok ? .12 : .2, e.ok ? 'triangle' : 'sawtooth', .12); if (e.t === me) banner(e.ok ? 'SKILL MOVE!' : 'HEAVY TOUCH', e.ok ? '#2ecc71' : '#e63946'); }
  else if (e.k === 'tfail') beep(120, .15, 'sawtooth', .08);
  else if (e.k === 'sub') { if (curLu) { curLu[e.t].order[e.slot] = e.idx; const i = e.t * NS + e.slot; ents[i] = mkEnt(G.team, curLu, e.t, e.slot, ents[i]); whoE = null; subSel = -1; if (!$('subs').classList.contains('hide')) renderSubs(); } banner('SUBSTITUTION', '#ffd23f'); beep(880, .15, 'triangle', .1); }
  else if (e.k === 'head' || e.k === 'volley') beep(260, .1, 'triangle', .25);
  else if (e.k === 'cross') beep(420, .25, 'triangle', .15);
  else if (e.k === 'post') { beep(1100, .2, 'square', .12); crowd(.2, 900, 1.5); }
  else if (e.k === 'half') { banner('HALF TIME', '#ffd23f'); beep(2000, .8, 'square', .06); }
  else if (e.k === 'end') { $('hud').classList.add('hide'); $('fpad').classList.add('hide'); $('menu').classList.remove('off'); show('end'); sessionStorage.removeItem('pof'); const a = e.score[me], b = e.score[1 - me]; $('endT').textContent = `${a > b ? 'YOU WIN' : a < b ? 'YOU LOSE' : 'DRAW'}  ${a} – ${b}`; $('subs').classList.add('hide'); $('bSubs').classList.add('hide'); showStats(e.st); }
}));

/* ---------- menu ---------- */
document.querySelectorAll('.team').forEach(b => b.onclick = () => { myTeam = b.dataset.t; sock.emit('team', myTeam); document.querySelectorAll('.team').forEach(x => x.classList.toggle('sel', x === b)); });
const fresh = () => { sessionStorage.removeItem('pof'); luInit = false; };
const nm = () => ({ name: POF.name() });
$('bQuick').onclick = () => { fresh(); sock.emit('quick', nm()); }; $('bCreate').onclick = () => { fresh(); sock.emit('create', nm()); }; $('bJoin').onclick = () => { fresh(); sock.emit('join', { code: $('code').value, ...nm() }); };
const nameBtn = () => { $('bName').textContent = 'Player: ' + POF.name() + '  ✎'; };
$('bName').onclick = () => POF.askName(true, nameBtn); POF.askName(false, nameBtn);
$('bReady').onclick = () => { sock.emit('team', myTeam); sock.emit('ready'); $('bReady').disabled = true; };
$('bSound').onclick = () => { snd = !snd; if (cg) cg.gain.value = snd ? .05 : 0; $('bSound').textContent = 'Sound: ' + (snd ? 'On' : 'Off'); };
$('bFull').onclick = () => { const d = document.documentElement; document.fullscreenElement ? document.exitFullscreen() : (d.requestFullscreen || d.webkitRequestFullscreen || (() => {})).call(d); };

/* ---------- substitutions (only while play is stopped) + match stats ---------- */
const canSub = () => S && (S.ph === 'dead' || S.ph === 'goal') && !S.pn;
function toggleSubs() { if (!G) return; const p = $('subs'); if (p.classList.contains('hide')) { renderSubs(); p.classList.remove('hide'); } else p.classList.add('hide'); }
function subRefresh(s) { const left = 5 - (s.sb ? s.sb[me] : 0); $('bSubs').textContent = `SUBS ${left}`; $('bSubs').classList.toggle('off', !canSub() || left <= 0); if (!$('subs').classList.contains('hide')) renderSubs(); }
function renderSubs() {
  if (!curLu || !G) return; const my = G.team[me], sq = SQ[my].r, o = curLu[me].order, used = new Set(o), left = 5 - (S && S.sb ? S.sb[me] : 0), ok = canSub() && left > 0;
  $('subMsg').textContent = ok ? `Tap a player on the pitch, then a bench player. Substitutions left: ${left}` : left <= 0 ? 'No substitutions left' : 'Substitutions are only possible while play is stopped (throw-in, free kick, goal…)';
  $('subSlots').innerHTML = o.map((idx, s) => { if (!s) return ''; const q = sq[idx], red = ents[me * NS + s] && ents[me * NS + s].red; return `<button data-s="${s}" ${red || !ok ? 'disabled' : ''} class="${subSel === s ? 'sel' : ''}"><span>${esc(q.n)} #${q.num}</span><b class="ov">${POF.ovr(q)}</b></button>`; }).join('');
  $('subBench').innerHTML = sq.map((q, i) => i && !used.has(i) ? `<button data-b="${i}" ${ok && subSel > 0 ? '' : 'disabled'}><span>${esc(q.n)} #${q.num}</span><b class="ov">${POF.ovr(q)}</b><small class="stl">${statLine(q)}</small></button>` : '').join('');
  document.querySelectorAll('#subSlots button').forEach(b => b.onclick = () => { subSel = subSel === +b.dataset.s ? -1 : +b.dataset.s; renderSubs(); });
  document.querySelectorAll('#subBench button').forEach(b => b.onclick = () => { if (subSel > 0) { sock.emit('sub', { slot: subSel, bench: +b.dataset.b }); subSel = -1; } });
}
$('bSubs').onclick = toggleSubs; $('subClose').onclick = () => $('subs').classList.add('hide');
function showStats(st) {
  if (!st) { $('endStats').innerHTML = ''; return; }
  const a = st[me], b = st[1 - me], row = (n, x, y) => `<div class="strow"><b>${x}</b><span>${n}</span><b>${y}</b></div>`;
  $('endStats').innerHTML = row('Possession %', a.poss, b.poss) + row('Shots', a.shots, b.shots) + row('Passes', a.passes, b.passes) + row('Tackles', a.tackles, b.tackles) + row('Fouls', a.fouls, b.fouls) + row('Dribbles won', `${a.drOk}/${a.dr}`, `${b.drOk}/${b.dr}`);
}

/* ---------- loop ---------- */
let last = performance.now(), frame = 0;
function loop(now) {
  requestAnimationFrame(loop); QL.tick(now); const dt = Math.min((now - last) / 1000, .05); last = now; frame++;
  const dmv = (me === 1 ? -1 : 1) * (flip ? -1 : 1);
  const cm = camMode(); if (G && S) sendInput(now, dmv, cm);
  groups.forEach((g, i) => { g.position.y = Math.max(0, Math.sin(now / 1000 * (celebT > 0 ? 9 : 2.2) + i * 1.7)) * (celebT > 0 ? .45 : .06); });
  celebT = Math.max(0, celebT - dt);
  const k = Math.min(1, dt * 14);
  ents.forEach(e => {
    e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; let da = e.ta - e.a; da = Math.atan2(Math.sin(da), Math.cos(da)); e.a += da * Math.min(1, dt * 12);
    e.g.visible = !e.red; e.sh.visible = !e.red && !SH; e.g.position.x = e.x; e.g.position.z = e.z; e.g.rotation.y = Math.atan2(Math.cos(e.a), Math.sin(e.a));
    e.sh.position.x = e.x; e.sh.position.z = e.z; animate(e, dt, bt, celebT > 0 ? celeb : -1);
  });
  const bk = Math.min(1, dt * (Bl.o >= 0 ? 22 : 18)), px = ball.position.x, pz = ball.position.z;
  ball.position.x += (bt.x - px) * bk; ball.position.y += (bt.y - ball.position.y) * bk; ball.position.z += (bt.z - pz) * bk;
  ball.rotation.z -= (ball.position.x - px) / BR; ball.rotation.x += (ball.position.z - pz) / BR;
  bsh.position.set(ball.position.x, .02, ball.position.z); const sc = BR * (1 + ball.position.y * .25); bsh.scale.set(sc, sc, sc); bsh.material.opacity = Math.max(.08, .35 - ball.position.y * .1);
  const ce = S && ents[S.k[me]]; ring.visible = arrow.visible = !!ce;
  if (ce) { ring.position.x = ce.x; ring.position.z = ce.z; arrow.position.set(ce.x, 2.25 + Math.sin(now / 200) * .08, ce.z); }
  dmCur += (dmv - dmCur) * Math.min(1, dt * 2);
  const bx = ball.position.x, bz = ball.position.z, V = THREE.Vector3; let tgt, look, kk = Math.min(1, dt * 3.5);
  if (cm.m === 'pk') { tgt = new V(S.b[0] - cm.d * 5, 2, 0); look = new V(cm.d * L, 1, 0); kk = Math.min(1, dt * 4); }
  else if (cm.m === 'pg') { tgt = new V(cm.d * (L + 4.5), 2.7, 0); look = new V(cm.d * (L - 6), .9, 0); kk = Math.min(1, dt * 4); }
  else if (cm.m === 'fk') { const gx = dmv * L, dx = gx - bx, dz = -bz, n = Math.hypot(dx, dz) || 1; tgt = new V(bx - dx / n * 5, 2.3, bz - dz / n * 5); look = new V(gx, 1, 0); kk = Math.min(1, dt * 4); }
  else { const q = Math.max(0, bz * dmCur), asp = cam.aspect < 1; tgt = new V(clamp(bx * .8, -19, 19), (asp ? 22 : 15.5) + q * .25, dmCur * ((asp ? 26 : 21) + q * .9)); look = new V(clamp(bx * .85, -22, 22), 0, bz * .55); }
  camPos.lerp(tgt, kk); camLook.lerp(look, kk); cam.position.copy(camPos); cam.lookAt(camLook);
  const cr = $('cross'); cr.classList.toggle('hide', cm.m !== 'pk');
  if (cm.m === 'pk') { tmpV.set(cm.d * L, .15 + S.pn[2] * 1.9, S.pn[1]).project(cam); cr.style.left = (tmpV.x * .5 + .5) * innerWidth + 'px'; cr.style.top = (-tmpV.y * .5 + .5) * innerHeight + 'px'; }
  netUpdate(dt);
  R.render(scene, cam);
}
requestAnimationFrame(loop);
})();
