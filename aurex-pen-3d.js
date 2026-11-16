/* AUREX PENALTY CUP – 3D scene (three.js r128). Pure presentation: the server decides every result.
 * World: goal line = plane z = 0, goal opens to +z, penalty mark at z = 11, y up (same numbers as aurex/pen-physics.js). */
(function () {
'use strict';
const P = window.AurexPenPhysics, C = P.C, PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t, ease = t => t * t * (3 - 2 * t);
const rnd = (() => { let s = 1234567; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();   // fixed seed: the stadium looks the same every time
const Gfx = {};
let R, scene, cam, canvas, ballMesh, ballShadow, reticle, trail, trailPts = [], sun, clock0 = performance.now();
let actors = [], ref = null, crowd = [], netBack, netBase, netHits = [], boards = [], flashes, floodSprites = [], shake = 0;
const S = { mode: 'menu', role: 'shooter', shooter: 0, keeper: 1, aim: { ax: 0, ay: 0.4, curve: 0, show: false, power: 0 }, keeperTarget: { x: 0, kz: 0 }, keeperPos: { x: 0, kz: 0 }, dive: null, run: null,
  ball: { x: 0, y: C.BR, z: C.SPOT_Z, vx: 0, vy: 0, vz: 0, hidden: false }, ballBuf: [], strikeAt: 0, now: () => Date.now(), pose: [{}, {}], intro: null, replay: null, camT: 0, celebrate: null, refState: 'idle', cardShow: 0, cardColor: 0xffd23f, camBlend: null, lastShot: null };

/* ----------------------------------------------------------------------------- textures */
function canvasTex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.anisotropy = Gfx.aniso || 4; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } return t;
}
function pitchTexture() {
  const W = 2048, H = 2048, mx = 68, mz = 66, sx = W / mx, sz = H / mz, X = m => (m + 34) * sx, Z = m => (m + 6) * sz;
  return canvasTex(W, H, (g) => {
    for (let i = 0; i < 14; i++) { g.fillStyle = i % 2 ? '#2f8a3a' : '#38983f'; g.fillRect(0, i * H / 14, W, H / 14 + 1); }
    // mown blades: tiny strokes in two greens
    g.lineWidth = 1;
    for (let i = 0; i < 90000; i++) { const x = rnd() * W, y = rnd() * H; g.strokeStyle = rnd() < 0.5 ? 'rgba(20,70,22,.10)' : 'rgba(120,200,90,.07)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - .5) * 3, y + 5 + rnd() * 5); g.stroke(); }
    // wear around the penalty mark and the goalmouth
    for (const [cx, cz, r, a] of [[0, 11, 1.6, .30], [0, 11, 3.4, .12], [0, 1.2, 4.8, .22], [0, 4.2, 5, .10]]) { const gr = g.createRadialGradient(X(cx), Z(cz), 0, X(cx), Z(cz), r * sx); gr.addColorStop(0, `rgba(104,92,52,${a})`); gr.addColorStop(1, 'rgba(104,92,52,0)'); g.fillStyle = gr; g.fillRect(X(cx) - r * sx, Z(cz) - r * sz, r * 2 * sx, r * 2 * sz); }
    g.strokeStyle = 'rgba(255,255,255,.93)'; g.lineWidth = 0.12 * sx; g.lineCap = 'butt';
    const line = (x1, z1, x2, z2) => { g.beginPath(); g.moveTo(X(x1), Z(z1)); g.lineTo(X(x2), Z(z2)); g.stroke(); };
    line(-34, 0, 34, 0); line(-34, 0, -34, 60); line(34, 0, 34, 60);                                   // goal line + touchlines
    line(-20.16, 0, -20.16, 16.5); line(20.16, 0, 20.16, 16.5); line(-20.16, 16.5, 20.16, 16.5);     // penalty area
    line(-9.16, 0, -9.16, 5.5); line(9.16, 0, 9.16, 5.5); line(-9.16, 5.5, 9.16, 5.5);               // goal area
    g.beginPath(); const a0 = Math.acos((16.5 - 11) / 9.15); g.arc(X(0), Z(11), 9.15 * sx, a0, PI - a0); g.stroke();   // penalty arc
    g.fillStyle = '#fff'; g.beginPath(); g.arc(X(0), Z(11), 0.2 * sx, 0, 7); g.fill();               // penalty mark
    g.beginPath(); g.arc(X(-34), Z(0), 1 * sx, 0, PI / 2); g.stroke(); g.beginPath(); g.arc(X(34), Z(0), 1 * sx, PI / 2, PI); g.stroke();
    // film grain over everything so the grass never looks flat
    const id = g.getImageData(0, 0, W, H), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - .5) * 14; d[i] += n; d[i + 1] += n * 1.1; d[i + 2] += n * .6; } g.putImageData(id, 0, 0);
  });
}
function netTexture() { return canvasTex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.moveTo(0, 0); g.lineTo(0, h); g.stroke(); }, [30, 12]); }
function boardTexture() {
  return canvasTex(1024, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#04123a'); gr.addColorStop(.5, '#0a2a7a'); gr.addColorStop(1, '#04123a'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.font = '700 38px "Bahnschrift","Arial Narrow",system-ui,sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
    ['AUREX ELITE', '★', 'PENALTY CUP', '★', 'AUREX ELITE', '★'].forEach((t, i) => { g.fillStyle = i % 2 ? '#f5c84a' : '#ffffff'; g.fillText(t, 85 + i * 170, 34); });
    g.fillStyle = 'rgba(255,255,255,.08)'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  }, [1, 1]);
}
function glowTexture(color) { return canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, color); gr.addColorStop(.25, color.replace(/[\d.]+\)$/, '.35)')); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }); }
function skyTexture() { return canvasTex(16, 512, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#020716'); gr.addColorStop(.55, '#0a1c46'); gr.addColorStop(1, '#27407a'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }); }

/* ----------------------------------------------------------------------------- stadium */
function buildStadium() {
  scene.background = skyTexture(); scene.fog = new THREE.Fog(0x0b1636, 60, 190);
  scene.add(new THREE.HemisphereLight(0xb8ccff, 0x2a4a2c, 0.85));
  sun = new THREE.DirectionalLight(0xfff3e0, 0.9); sun.position.set(-14, 34, 26); sun.target.position.set(0, 0, 8);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 20; sc.bottom = -12; sc.near = 5; sc.far = 90; sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x7fa0ff, 0.28); fill.position.set(20, 18, -10); scene.add(fill);

  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(68, 66), new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.95, metalness: 0 }));
  pitch.rotation.x = -PI / 2; pitch.position.set(0, 0, 27); pitch.receiveShadow = true; scene.add(pitch);   // x -34..34, z -6..60
  const run = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ color: 0x1f5a2c, roughness: 1 })); run.rotation.x = -PI / 2; run.position.set(0, -0.02, 20); run.receiveShadow = true; scene.add(run);
  const track = new THREE.Mesh(new THREE.PlaneGeometry(92, 98), new THREE.MeshStandardMaterial({ color: 0x24703a, roughness: 1 })); track.rotation.x = -PI / 2; track.position.set(0, -0.01, 25); scene.add(track);

  // LED advertising boards (scrolling)
  const bt = boardTexture(); const bm = new THREE.MeshBasicMaterial({ map: bt }); boards.push(bt);
  const mkBoard = (w, x, y, z, ry) => { bt.repeat.set(Math.max(1, Math.round(w / 12)), 1); const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, 0.12), bm); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); return m; };
  mkBoard(76, 0, 0.45, -6.2, 0); mkBoard(60, -37.5, 0.45, 26, PI / 2); mkBoard(60, 37.5, 0.45, 26, -PI / 2);
  // stands
  const concrete = new THREE.MeshStandardMaterial({ color: 0x2b3142, roughness: 0.9 });
  const tier = (cx, cz, w, d, steps, dx, dz) => { for (let k = 0; k < steps; k++) { const h = 1.1 * (k + 1), b = new THREE.Mesh(new THREE.BoxGeometry(dx ? 1.7 : w, h, dz ? 1.7 : d), concrete); b.position.set(cx + dx * k * 1.7, h / 2, cz + dz * k * 1.7); scene.add(b); } };
  tier(0, -9, 80, 1.7, 11, 0, -1); tier(-40, 26, 1.7, 76, 9, -1, 0); tier(40, 26, 1.7, 76, 9, 1, 0); tier(0, 64, 80, 1.7, 8, 0, 1);
  // spectators (instanced)
  const pal = [0x1e3fae, 0x2b5cff, 0xf5c84a, 0xffffff, 0xdfe6f5, 0x0f1b4c, 0xc23a3a, 0x20262f, 0x35c486], skin = [0xd9a77a, 0xf1c7a0, 0x8d5a3b, 0xc68642, 0x6b4430];
  const spots = [];
  const rows = (cx, cz, w, d, steps, dx, dz, step) => { for (let k = 0; k < steps; k++) { const h = 1.1 * (k + 1), px = cx + dx * k * 1.7, pz = cz + dz * k * 1.7, len = dx ? d : w; for (let i = 0; i < len / step; i++) { if (rnd() < 0.08) continue; const o = -len / 2 + i * step + rnd() * 0.18; spots.push(dx ? [px, h + 0.5, cz + o] : [cx + o, h + 0.5, pz]); } } };
  rows(0, -9, 80, 1.7, 11, 0, -1, 0.85); rows(-40, 26, 1.7, 76, 9, -1, 0, 0.85); rows(40, 26, 1.7, 76, 9, 1, 0, 0.85); rows(0, 64, 80, 1.7, 8, 0, 1, 0.9);
  const NG = 4, dm = new THREE.Object3D();
  for (let q = 0; q < NG; q++) {
    const pts = spots.filter((_, i) => i % NG === q), grp = new THREE.Group();
    const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.7, 0.34), new THREE.MeshLambertMaterial(), pts.length), heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshLambertMaterial(), pts.length);
    pts.forEach((p, i) => { dm.position.set(p[0], p[1], p[2]); dm.rotation.set(0, 0, 0); dm.updateMatrix(); bodies.setMatrixAt(i, dm.matrix); dm.position.y += 0.55; dm.updateMatrix(); heads.setMatrixAt(i, dm.matrix); bodies.setColorAt(i, new THREE.Color(pal[Math.floor(rnd() * pal.length)])); heads.setColorAt(i, new THREE.Color(skin[Math.floor(rnd() * skin.length)])); });
    grp.add(bodies, heads); scene.add(grp); crowd.push(grp);
  }
  // roof rim + giant screen behind the goal
  const screenTex = canvasTex(1024, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#04123a'); gr.addColorStop(.5, '#0b2f86'); gr.addColorStop(1, '#04123a'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.font = '700 110px "Bahnschrift","Arial Narrow",system-ui,sans-serif'; g.fillText('AUREX ELITE', w / 2, h * .42); g.fillStyle = '#f5c84a'; g.font = '600 44px "Bahnschrift","Arial Narrow",system-ui,sans-serif'; g.fillText('PENALTY CUP', w / 2, h * .78); });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(26, 6.5), new THREE.MeshBasicMaterial({ map: screenTex })); screen.position.set(0, 16.5, -27.6); scene.add(screen);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(84, 0.6, 1), new THREE.MeshBasicMaterial({ color: 0x5b95ff })); rim.position.set(0, 22, -28); scene.add(rim);
  // floodlight towers (glare sprites + a spot that lights the penalty area)
  const glow = glowTexture('rgba(255,248,224,1)');
  [[-46, -22], [46, -22], [-46, 70], [46, 70]].forEach(([x, z], i) => {
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 34, 8), new THREE.MeshStandardMaterial({ color: 0x4a5163, roughness: .8 })); tw.position.set(x, 17, z); scene.add(tw);
    const head = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 1.2), new THREE.MeshBasicMaterial({ color: 0xfff6d8 })); head.position.set(x, 35, z); head.lookAt(0, 8, 14); scene.add(head);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); sp.scale.set(26, 26, 1); sp.position.set(x, 35, z); scene.add(sp); floodSprites.push(sp);
    if (i < 2) { const s = new THREE.SpotLight(0xfff0d8, 0.9, 140, 0.55, 0.6, 1.2); s.position.set(x, 35, z); s.target.position.set(0, 0, 8); scene.add(s, s.target); }
  });
  // camera flashes in the crowd
  const fg = new THREE.BufferGeometry(), N = 90, fp = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const s = spots[Math.floor(rnd() * spots.length)]; fp[i * 3] = s[0]; fp[i * 3 + 1] = s[1] + 0.9; fp[i * 3 + 2] = s[2]; }
  fg.setAttribute('position', new THREE.BufferAttribute(fp, 3)); flashes = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(flashes);
}

/* ----------------------------------------------------------------------------- goal */
function buildGoal() {
  const white = new THREE.MeshStandardMaterial({ color: 0xf6f8fb, roughness: 0.35, metalness: 0.35 });
  const post = (x) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(C.POST_R, C.POST_R, C.BAR_H + C.POST_R, 16), white); m.position.set(x, (C.BAR_H + C.POST_R) / 2, 0); m.castShadow = true; scene.add(m); };
  post(-C.HALF_W); post(C.HALF_W);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(C.POST_R, C.POST_R, C.HALF_W * 2 + C.POST_R * 2, 16), white); bar.rotation.z = PI / 2; bar.position.set(0, C.BAR_H, 0); bar.castShadow = true; scene.add(bar);
  const fr = new THREE.MeshStandardMaterial({ color: 0xdfe5ee, roughness: .5, metalness: .3 });
  const rod = (x1, y1, z1, x2, y2, z2) => { const a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2), m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, a.distanceTo(b), 8), fr); m.position.copy(a).add(b).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); scene.add(m); };
  for (const sx of [-1, 1]) { rod(sx * C.HALF_W, C.BAR_H, 0, sx * C.HALF_W, C.BAR_H, -C.NET_D); rod(sx * C.HALF_W, C.BAR_H, -C.NET_D, sx * C.HALF_W, 0, -C.NET_D); rod(sx * C.HALF_W, 0, 0, sx * C.HALF_W, 0, -C.NET_D); }
  rod(-C.HALF_W, C.BAR_H, -C.NET_D, C.HALF_W, C.BAR_H, -C.NET_D);
  const nt = netTexture(), nm = new THREE.MeshBasicMaterial({ map: nt, transparent: true, opacity: .7, side: THREE.DoubleSide, depthWrite: false });
  netBack = new THREE.Mesh(new THREE.PlaneGeometry(C.HALF_W * 2, C.BAR_H, 28, 12), nm); netBack.position.set(0, C.BAR_H / 2, -C.NET_D); scene.add(netBack); netBase = netBack.geometry.attributes.position.array.slice();
  const side = (sx) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(C.NET_D, C.BAR_H), nm); m.rotation.y = PI / 2; m.position.set(sx * C.HALF_W, C.BAR_H / 2, -C.NET_D / 2); scene.add(m); };
  side(-1); side(1);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(C.HALF_W * 2, C.NET_D), nm); top.rotation.x = PI / 2; top.position.set(0, C.BAR_H, -C.NET_D / 2); scene.add(top);
}
Gfx.netImpact = function (x, y, speed) { netHits.push({ x, y, a: clamp(speed / 25, 0.25, 1) * 0.55, t0: performance.now() }); if (netHits.length > 4) netHits.shift(); };
function updateNet(nowMs) {
  const pos = netBack.geometry.attributes.position, arr = pos.array; let any = false;
  for (let i = 0; i < arr.length; i += 3) {
    let dz = 0; const vx = netBase[i] , vy = netBase[i + 1] + C.BAR_H / 2;
    for (const h of netHits) { const t = (nowMs - h.t0) / 1000; if (t > 3) continue; const d2 = (vx - h.x) * (vx - h.x) + (vy - h.y) * (vy - h.y); dz -= h.a * Math.exp(-d2 / 0.9) * Math.exp(-2.6 * t) * Math.cos(11 * t); }
    arr[i] = netBase[i]; arr[i + 1] = netBase[i + 1]; arr[i + 2] = netBase[i + 2] + dz; if (dz) any = true;
  }
  if (any || netHits.length) { pos.needsUpdate = true; netHits = netHits.filter(h => nowMs - h.t0 < 3000); }
}

/* ----------------------------------------------------------------------------- people */
const KITS = {
  barcelona: { shirt: 'stripes', c: ['#a50044', '#004d98'], shorts: 0x0a2a6a, socks: 0xa50044 },
  realmadrid: { shirt: 'plain', c: ['#f4f4f6', '#e6e6ee'], shorts: 0xf4f4f6, socks: 0xf4f4f6, trim: '#e5b85a' },
  psg: { shirt: 'band', c: ['#0b2a5c', '#d8213a'], shorts: 0x0b2a5c, socks: 0x0b2a5c },
  atletico: { shirt: 'stripes', c: ['#cb3524', '#f4f4f4'], shorts: 0x1b2a6b, socks: 0xcb3524 },
};
const KEEPER_COLORS = ['#b8ff1a', '#ff8a00', '#ff3d8b', '#00d8ff', '#a66bff'];
const hex = s => parseInt(s.replace('#', ''), 16);
function lum(h) { const r = (h >> 16) & 255, g = (h >> 8) & 255, b = h & 255; return 0.3 * r + 0.59 * g + 0.11 * b; }
function kitFor(team) {
  const club = team && team.club, base = club && KITS[club.id];
  if (base) return base;
  const cs = club && club.colors && club.colors.length >= 2 ? club.colors : ['#1d4ed8', '#f5c84a'];
  return { shirt: 'hoops', c: cs, shorts: hex(cs[1]) === hex(cs[0]) ? 0x10204a : hex(cs[1]), socks: hex(cs[0]) };
}
function shirtTexture(kit) {
  return canvasTex(256, 128, (g, w, h) => {
    const [a, b] = kit.c;
    if (kit.shirt === 'stripes') { const n = 10; for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * w / n, 0, w / n + 1, h); } }
    else if (kit.shirt === 'band') { g.fillStyle = a; g.fillRect(0, 0, w, h); g.fillStyle = b; g.fillRect(w * .42, 0, w * .16, h); g.fillRect(w * -.08, 0, w * .16, h); g.fillRect(w * .92, 0, w * .16, h); }
    else if (kit.shirt === 'hoops') { const n = 6; for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(0, i * h / n, w, h / n + 1); } }
    else { g.fillStyle = a; g.fillRect(0, 0, w, h); g.fillStyle = kit.trim || b; g.fillRect(0, 0, w, 6); }
    // fabric weave
    g.fillStyle = 'rgba(0,0,0,.05)'; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  });
}
function backTexture(name, num, fg) {
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 38px "Bahnschrift","Arial Narrow",system-ui,sans-serif'; g.fillText(name.toUpperCase().slice(0, 12), w / 2, 40);
    g.font = '700 150px "Bahnschrift","Arial Narrow",system-ui,sans-serif'; g.fillText(String(num), w / 2, 150);
  });
}
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const SKINS = [0xf1c7a0, 0xd9a77a, 0xc68642, 0x8d5a3b, 0x6b4430, 0xe8b894], HAIRS = [0x17120d, 0x2c1b10, 0x4a3320, 0x0c0c0c, 0x6b4a2a, 0x8a6a3a];

/** Builds an articulated person. Origin = between the feet on the ground, front = +z. */
function makePerson(o) {
  const hs = hash(o.name || 'x'), skin = SKINS[hs % SKINS.length], hair = HAIRS[(hs >> 4) % HAIRS.length];
  const std = (c, r = 0.7) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
  const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner);
  const hips = new THREE.Group(); hips.position.y = 0.98; inner.add(hips);
  const shirtMat = new THREE.MeshStandardMaterial({ map: shirtTexture(o.kit), roughness: 0.78 });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.165, 0.6, 24), shirtMat); torso.scale.z = 0.62; torso.position.y = 0.32; torso.castShadow = true; hips.add(torso);
  const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.2, 20), std(o.kit.shorts, 0.8)); pelvis.scale.z = 0.66; pelvis.position.y = -0.04; hips.add(pelvis);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({ map: backTexture(o.name, o.num, o.numColor || '#ffffff'), transparent: true, depthWrite: false })); back.position.set(0, 0.33, -0.127); back.rotation.y = PI; hips.add(back);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), std(skin)); neck.position.y = 0.66; hips.add(neck);
  const head = new THREE.Group(); head.position.y = 0.8; hips.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), std(skin, 0.6)); skull.scale.set(0.92, 1.08, 1); skull.castShadow = true; head.add(skull);
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.122, 20, 12, 0, PI * 2, 0, PI * 0.55), std(hair, 0.9)); hairM.scale.set(0.95, 1.08, 1.03); hairM.position.set(0, 0.012, -0.008); head.add(hairM);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshBasicMaterial({ color: 0x15110f })); eye.position.set(sx * 0.042, 0.018, 0.108); head.add(eye);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.007, 0.006), new THREE.MeshBasicMaterial({ color: hair })); brow.position.set(sx * 0.042, 0.048, 0.108); head.add(brow);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), std(skin)); ear.position.set(sx * 0.108, -0.005, 0); ear.scale.set(0.5, 1, 0.8); head.add(ear);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), std(skin)); nose.position.set(0, -0.012, 0.115); head.add(nose);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.005), new THREE.MeshBasicMaterial({ color: 0x5a2c2c })); mouth.position.set(0, -0.058, 0.104); head.add(mouth);
  // arms
  const armMat = o.keeper ? std(o.keeperShirt, 0.8) : std(hex(o.kit.c[0]), 0.8);
  function arm(sx) {
    const up = new THREE.Group(); up.position.set(sx * 0.255, 0.56, 0); hips.add(up);
    const u = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.045, 0.3, 10), armMat); u.position.y = -0.15; u.castShadow = true; up.add(u);
    const el = new THREE.Group(); el.position.y = -0.3; up.add(el);
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.036, 0.28, 10), o.keeper ? armMat : std(skin)); f.position.y = -0.14; el.add(f);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(o.keeper ? 0.07 : 0.04, 10, 8), o.keeper ? std(o.glove, 0.6) : std(skin)); hand.position.y = -0.3; if (o.keeper) hand.scale.set(1, 1.15, 0.8); el.add(hand);
    return { up, el };
  }
  const aL = arm(-1), aR = arm(1);
  // legs
  const sockMat = std(o.keeper ? o.keeperShirt : o.kit.socks, 0.85), bootMat = new THREE.MeshStandardMaterial({ color: o.boot || 0x15171d, roughness: 0.4, metalness: 0.2 });
  function leg(sx) {
    const th = new THREE.Group(); th.position.set(sx * 0.098, -0.09, 0); hips.add(th);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.062, 0.44, 12), std(o.kit.shorts, 0.8)); t.position.y = -0.2; t.castShadow = true; th.add(t);
    const kn = new THREE.Group(); kn.position.y = -0.42; th.add(kn);
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.42, 12), sockMat); s.position.y = -0.21; s.castShadow = true; kn.add(s);
    const ft = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.07, 0.25), bootMat); ft.position.set(0, -0.44, 0.06); ft.castShadow = true; kn.add(ft);
    return { th, kn };
  }
  const lL = leg(-1), lR = leg(1);
  root.userData = { inner, hips, head, aL, aR, lL, lR, skin, name: o.name, keeper: !!o.keeper };
  root.traverse(m => { if (m.isMesh) m.frustumCulled = true; });
  return root;
}
function setPose(p, o) {
  const u = p.userData, d = o || {};
  u.hips.position.y = d.hipY == null ? 0.98 : d.hipY; u.hips.rotation.set(d.tx || 0, d.ty || 0, d.tz || 0); u.head.rotation.set(d.hx || 0, d.hy || 0, 0);
  u.aL.up.rotation.set(d.aLx || 0, 0, -(d.aLz || 0.08)); u.aR.up.rotation.set(d.aRx || 0, 0, d.aRz == null ? 0.08 : d.aRz);
  u.aL.el.rotation.x = -(d.eL || 0.25); u.aR.el.rotation.x = -(d.eR || 0.25);
  u.lL.th.rotation.set(d.lLx || 0, 0, 0); u.lR.th.rotation.set(d.lRx || 0, 0, 0); u.lL.kn.rotation.x = d.kLx || 0; u.lR.kn.rotation.x = d.kRx || 0;
}
const poses = {
  idle: (t) => ({ hipY: 0.98 + Math.sin(t * 1.8) * 0.004, aLx: Math.sin(t * 1.5) * 0.03, aRx: -Math.sin(t * 1.5) * 0.03 }),
  jog: (t, k = 1) => { const s = Math.sin(t * 9), c = Math.cos(t * 9); return { hipY: 0.96 + Math.abs(c) * 0.03 * k, tx: 0.1 * k, lLx: s * 0.7 * k, lRx: -s * 0.7 * k, kLx: Math.max(0, -s) * 1.0 * k, kRx: Math.max(0, s) * 1.0 * k, aLx: -s * 0.8 * k, aRx: s * 0.8 * k, eL: 1.0, eR: 1.0 }; },
  celebrate: (t) => ({ hipY: 0.98 + Math.abs(Math.sin(t * 8)) * 0.18, aLz: 2.5, aRz: 2.5, aLx: 0, aRx: 0, eL: 0.2, eR: 0.2, lLx: 0.1, lRx: -0.1, hx: -0.25 }),
  dejected: () => ({ hipY: 0.94, tx: 0.32, hx: 0.5, aLz: 0.05, aRz: 0.05, eL: 0.1, eR: 0.1 }),
  ready: (t) => ({ hipY: 0.84 + Math.sin(t * 3) * 0.008, tx: 0.2, aLz: 0.9 + Math.sin(t * 2) * 0.05, aRz: 0.9 + Math.sin(t * 2) * 0.05, eL: 0.7, eR: 0.7, lLx: -0.45, lRx: -0.45, kLx: 0.9, kRx: 0.9, aLx: 0.35, aRx: 0.35 }),
  roar: (t) => ({ hipY: 0.98, aLz: 2.2, aRz: 2.2, eL: 0.4, eR: 0.4, hx: -0.3 + Math.sin(t * 12) * 0.05 }),
  whistle: () => ({ aRx: -1.9, aRz: 0.3, eR: 2.2, hx: 0.05 }),
  card: () => ({ aRx: 0, aRz: 2.9, eR: 0.1 }),
  varSign: () => ({ aLx: -1.3, aRx: -1.3, aLz: 0.5, aRz: 0.5, eL: 1.9, eR: 1.9 }),
};
/** run-up + kick: p = 0 … 1, 1 = contact */
function kickPose(p) {
  const run = Math.sin(p * 17);
  if (p < 0.82) return { hipY: 0.96, tx: 0.18, lLx: run * 0.7, lRx: -run * 0.7, kLx: Math.max(0, -run) * 1.1, kRx: Math.max(0, run) * 1.1, aLx: -run * 0.8, aRx: run * 0.8, eL: 1, eR: 1 };
  const q = clamp((p - 0.82) / 0.18, 0, 1);         // wind-up (back) then strike (forward)
  const swing = q < 0.55 ? lerp(0.15, -1.0, q / 0.55) : lerp(-1.0, 1.45, (q - 0.55) / 0.45);
  return { hipY: 0.95, tx: 0.14 + q * 0.12, aLz: 0.9, aRz: 0.6, eL: 0.5, eR: 0.5, _kick: swing };
}
function applyKick(p, d) { const sw = d._kick; setPose(p, { ...d, lRx: sw, kRx: sw < 0 ? 1.4 : 0.1, lLx: -0.3, kLx: 0.45 }); }

/* ----------------------------------------------------------------------------- actors */
Gfx.setActors = function (infos) {
  actors.forEach(a => scene.remove(a)); if (ref) scene.remove(ref); actors = [];
  const kits = infos.map(i => kitFor(i.team));
  infos.forEach((info, i) => {
    const kit = kits[i], other = kits[1 - i];
    const prim = hex(other.c[0]);
    const kc = KEEPER_COLORS.map(hex).find(c => Math.abs(lum(c) - lum(prim)) > 60 && Math.abs(lum(c) - lum(hex(kit.c[0]))) > 40) || hex(KEEPER_COLORS[0]);
    // each player gets two bodies: outfield (kicker) and goalkeeper, only the one in use is visible
    const out = makePerson({ name: info.username, num: 10, kit, numColor: lum(hex(kit.c[0])) > 150 ? '#10204a' : '#ffffff' });
    const gk = makePerson({ name: info.username, num: 1, kit: { ...kit, shirt: 'plain', trim: '#222222', shorts: 0x15171d, socks: kc, c: [`#${kc.toString(16).padStart(6, '0')}`, '#222222'] }, keeper: true, keeperShirt: kc, glove: 0xf3f5f8, numColor: '#101010', boot: 0xeeeeee });
    const g = new THREE.Group(); g.add(out, gk); g.userData = { out, gk, info }; scene.add(g); actors.push(g);
  });
  ref = makePerson({ name: 'REF', num: 0, kit: { shirt: 'plain', c: ['#141414', '#f5d000'], shorts: 0x141414, socks: 0x141414 }, numColor: '#f5d000', boot: 0x222222 });
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.006), new THREE.MeshBasicMaterial({ color: 0xffd23f })); card.visible = false; card.position.set(0, -0.36, 0.03); ref.userData.aR.el.add(card); ref.userData.card = card;
  ref.position.set(8.5, 0, 6.5); ref.rotation.y = -PI * 0.62; scene.add(ref);
};

/* ----------------------------------------------------------------------------- cameras */
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmpV = new THREE.Vector3();
function camTarget(mode, t) {
  const spot = S.ball;
  switch (mode) {
    case 'shooter': return [[Math.sin(t * 0.4) * 0.12, 1.85, 17.4], [0, 1.2, 0.5], 42];
    case 'keeper': return [[S.keeperPos.x * 0.6, 2.1, -3.6], [0, 1.0, 11.5], 50];
    case 'flightS': return [[-0.3, 1.8, 17.4], [S.ball.x * 0.45, Math.min(S.ball.y, 1.8) + 0.2, Math.max(S.ball.z - 5, -1.5)], 42];
    case 'flightK': return [[S.keeperPos.x * 0.6, 2.0, -3.6], [S.ball.x * 0.6, Math.min(S.ball.y + 0.2, 1.8), Math.max(S.ball.z - 2, 0)], 48];
    case 'result': return [[-9, 2.3, 4.5], [0.5, 1.0, 1.5], 44];
    case 'goalcam': return [[4.8, 1.0, -3.2], [-0.5, 1.1, 2.4], 42];
    case 'side': return [[-11, 1.8, 9], [0, 1.1, 5.5], 40];
    case 'var': return [[0, 9, 7], [0, 0, 5], 46];
    case 'end': return [[Math.sin(t * 0.25) * 9, 2.4, 9 + Math.cos(t * 0.25) * 4], [0, 1.2, 8], 50];
    default: return [[0, 6, 22], [0, 1, 6], 55];
  }
}
Gfx.camera = function (mode, snap) { S.mode = mode; if (snap) S.camSnap = true; };

/* ----------------------------------------------------------------------------- public API */
Gfx.init = function (cv, opts) {
  canvas = cv; opts = opts || {};
  R = new THREE.WebGLRenderer({ canvas, antialias: !(matchMedia('(pointer:coarse)').matches && (devicePixelRatio || 1) >= 2), powerPreference: 'high-performance' });
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.15; R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  Gfx.aniso = Math.min(8, R.capabilities.getMaxAnisotropy ? R.capabilities.getMaxAnisotropy() : 4);
  Gfx.Q = window.POF && POF.Quality ? POF.Quality(R, Math.min(devicePixelRatio || 1, 2), 1) : null; if (!Gfx.Q) R.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(52, 1, 0.1, 400); Gfx.cam = cam;
  buildStadium(); buildGoal();
  ballMesh = window.POF && POF.classicBall ? POF.classicBall(THREE, C.BR) : new THREE.Mesh(new THREE.SphereGeometry(C.BR, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff })); ballMesh.castShadow = true; ballMesh.position.set(0, C.BR, C.SPOT_Z); scene.add(ballMesh);
  ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.4, depthWrite: false })); ballShadow.rotation.x = -PI / 2; ballShadow.position.y = 0.01; scene.add(ballShadow);
  const rg = new THREE.RingGeometry(0.2, 0.26, 40); reticle = new THREE.Group();
  reticle.add(new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false })));
  const cross = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false })); reticle.add(cross, cross.clone()); reticle.children[2].rotation.z = PI / 2;
  reticle.renderOrder = 10; reticle.children.forEach(c => { c.renderOrder = 10; }); reticle.visible = false; scene.add(reticle);
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3)); trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xbfd6ff, transparent: true, opacity: 0.45 })); trail.frustumCulled = false; scene.add(trail);
  Gfx.resize(); addEventListener('resize', Gfx.resize);
  camPos.set(0, 16, 40); camLook.set(0, 1, 8);
};
Gfx.resize = function () { if (!R) return; R.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; Gfx.baseFov = cam.aspect < 1 ? 70 : 52; cam.updateProjectionMatrix(); };
Gfx.setClock = f => { S.now = f; };
Gfx.reticleRay = function (cx, cy) {     // screen point -> aim in goal units, via a ray to the goal plane z = 0
  const v = new THREE.Vector3((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1, 0.5).unproject(cam), d = v.sub(cam.position).normalize();
  if (Math.abs(d.z) < 1e-4) return null; const k = -cam.position.z / d.z; if (k <= 0) return null;
  const x = cam.position.x + d.x * k, y = cam.position.y + d.y * k; return { ax: clamp(x / C.HALF_W, -1.4, 1.4), ay: clamp(y / C.BAR_H, 0, 1.45) };
};
Gfx.setRole = (role, shooter, keeper) => { S.role = role; S.shooter = shooter; S.keeper = keeper; };
Gfx.setAim = (ax, ay, curve, show, power) => { S.aim = { ax, ay, curve, show, power: power || 0 }; };
Gfx.keeperTo = (x, kz) => { S.keeperTarget = { x, kz }; };
Gfx.keeperSnap = (x, kz) => { S.keeperTarget = { x, kz }; S.keeperPos = { x, kz }; };
Gfx.startRun = (runAt, strikeAt) => { S.run = { runAt, strikeAt, pf: null, fs: 0, fr: 0 }; };
Gfx.feint = (progress, strikeAt) => { if (S.run) { S.run.pf = progress; S.run.fs = S.now(); S.run.fr = S.now() + 240; S.run.strikeAt = strikeAt; } };
Gfx.setDive = (dir, hi, tdLocal) => { S.dive = { dir, hi, td: tdLocal }; };
Gfx.clearTurn = () => { S.dive = null; S.run = null; S.ballBuf = []; S.ball = { x: 0, y: C.BR, z: C.SPOT_Z }; S.strikeAt = 0; trailPts = []; S.celebrate = null; S.lastShot = null; S.replay = null; ballMesh.visible = true; };
Gfx.setStrike = t => { S.strikeAt = t; };
Gfx.pushBall = (from, pts, replace) => { if (replace) S.ballBuf.length = Math.min(S.ballBuf.length, from); for (let i = 0; i < pts.length; i++) S.ballBuf[from + i] = pts[i]; };
Gfx.ballBuffer = () => S.ballBuf;
Gfx.react = (kind, shooter, keeper) => { S.celebrate = { kind, shooter, keeper, t0: S.now() }; };
Gfx.refSignal = (what, color) => { S.refState = what; S.refT0 = S.now(); if (ref) { ref.userData.card.visible = what === 'card'; ref.userData.card.material.color.setHex(color || 0xffd23f); } };
Gfx.crowdCheer = (on) => { S.cheer = on ? S.now() + 2500 : 0; };
Gfx.shake = a => { shake = Math.max(shake, a); };
Gfx.startIntro = (t0, durMs) => { S.intro = { t0, dur: durMs }; S.mode = 'intro'; };
Gfx.stopIntro = () => { S.intro = null; };
Gfx.startReplay = (samples, speed, camMode) => { if (!samples || samples.length < 3) return; S.replay = { s: samples, t0: S.now(), speed: speed || 0.35, cam: camMode || 'goalcam', until: S.now() + (samples[samples.length - 1][0] / (speed || 0.35)) * 1000 + 500 }; };
Gfx.stopReplay = () => { S.replay = null; };
Gfx.isReplaying = () => !!S.replay;

/* ----------------------------------------------------------------------------- frame */
function ballFromBuffer(tSec) {
  const b = S.ballBuf; if (!b.length) return null;
  let i = 0; while (i < b.length - 1 && b[i + 1] && b[i + 1][0] <= tSec) i++;
  const a = b[i], c = b[i + 1]; if (!a) return null;
  if (!c || tSec <= a[0]) return { x: a[1], y: a[2], z: a[3], last: !c };
  const k = clamp((tSec - a[0]) / (c[0] - a[0] || 1), 0, 1); return { x: lerp(a[1], c[1], k), y: lerp(a[2], c[2], k), z: lerp(a[3], c[3], k) };
}
function placeActors(tNow, nowT) {
  const sh = actors[S.shooter], kp = actors[S.keeper]; if (!sh || !kp) return;
  sh.userData.out.visible = true; sh.userData.gk.visible = false; kp.userData.out.visible = false; kp.userData.gk.visible = true;
  actors.forEach((a, i) => { if (i !== S.shooter && i !== S.keeper) a.visible = false; else a.visible = true; });
  // kicker
  const o = sh.userData.out; const run = S.run, strike = S.strikeAt || (run && run.strikeAt) || 0;
  let p = 0, restPos = [-2.6, 15.6];
  if (run) {
    let q = (nowT - run.runAt) / Math.max(1, (run.strikeAt - run.runAt));
    if (run.pf != null) { if (nowT < run.fr) q = run.pf; else q = run.pf + (1 - run.pf) * clamp((nowT - run.fr) / Math.max(1, run.strikeAt - run.fr), 0, 1); }
    p = clamp(q, 0, 1.08);
  }
  const ez = p >= 1 ? 1 : ease(clamp(p, 0, 1));
  const px = lerp(restPos[0], -0.42, ez), pz = lerp(restPos[1], 11.55, ez) + (p > 1 ? Math.min(0.5, (p - 1) * 4) : 0);
  sh.position.set(px, 0, pz);
  sh.rotation.y = Math.atan2(0 - px, 0 - pz);           // the model's front is +z: turn it towards the goal
  if (S.celebrate && S.celebrate.shooter === S.shooter) {
    const c = S.celebrate, dt = (nowT - c.t0) / 1000;
    if (c.kind === 'goal') { setPose(o, poses.celebrate(nowT / 1000)); sh.position.z = pz + Math.min(dt * 3.2, 5.5); sh.rotation.y = 0; }
    else setPose(o, poses.dejected());
  } else if (!run) setPose(o, poses.ready(nowT / 1000 * 0.6));
  else if (p < 1.0 || nowT < strike + 150) applyKick(o, kickPose(Math.min(p, 1)));
  else setPose(o, poses.idle(nowT / 1000));
  // keeper
  const g = kp.userData.gk, k = S.keeperPos; k.x += (S.keeperTarget.x - k.x) * 0.35; k.kz += (S.keeperTarget.kz - k.kz) * 0.35;
  let pose = null;
  if (S.dive) {
    const d = S.dive, tt = (nowT - d.td) / 1000;
    pose = P.keeperPose({ x: k.x, kz: k.kz, dive: { dir: d.dir, hi: d.hi, at: 0 } }, tt);
  }
  if (pose && pose.kind) {
    kp.position.set(pose.cx, pose.cy, k.kz); g.position.y = -0.95; kp.rotation.set(0, 0, -Math.atan2(pose.ux, pose.uy)); kp.rotation.order = 'XYZ';
    const armA = lerp(1.35, 3.05, 1 - pose.spread);
    setPose(g, { hipY: 0.98, aLz: armA, aRz: armA, aLx: 0, aRx: 0, eL: 0.05, eR: 0.05, lLx: -0.12, lRx: 0.12, kLx: 0.2, kRx: 0.2, hx: -0.2 });
  } else {
    g.position.y = 0; kp.rotation.set(0, 0, 0); kp.position.set(k.x, 0, k.kz);
    const shuffle = Math.abs(S.keeperTarget.x - k.x) > 0.02 ? Math.sin(nowT / 70) * 0.25 : 0;
    if (S.celebrate && S.celebrate.keeper === S.keeper && S.celebrate.kind !== 'goal') setPose(g, poses.roar(nowT / 1000)); else if (S.celebrate && S.celebrate.kind === 'goal' && S.celebrate.keeper === S.keeper) setPose(g, poses.dejected());
    else { const rd = poses.ready(nowT / 1000); rd.lLx += shuffle; rd.lRx -= shuffle; setPose(g, rd); }
    kp.rotation.y = 0;
  }
  if (!pose || !pose.kind) kp.rotation.y = 0;
  // referee
  if (ref) {
    const rs = S.refState; let po = poses.idle(nowT / 1000); const dt = (nowT - (S.refT0 || 0));
    if (rs === 'whistle' && dt < 900) po = poses.whistle(); else if (rs === 'card' && dt < 2600) po = poses.card(); else if (rs === 'var' && dt < 6000) po = poses.varSign();
    setPose(ref, po); ref.userData.card.visible = rs === 'card' && dt < 2600;
    if (!S.intro) { ref.position.set(8.5, 0, 6.5); ref.rotation.y = Math.atan2(0 - 8.5, 11 - 6.5); }
  }
}
function introUpdate(nowT) {
  const it = S.intro; if (!it) return false;
  const t = (nowT - it.t0) / 1000, sh = actors[0], sk = actors[1]; if (!sh || !sk) return false;
  actors.forEach(a => { a.visible = true; a.userData.out.visible = true; a.userData.gk.visible = false; });
  const walk = (obj, from, to, t0, t1, face) => {
    const k = clamp((t - t0) / (t1 - t0), 0, 1), x = lerp(from[0], to[0], ease(k)), z = lerp(from[1], to[1], ease(k));
    obj.position.set(x, 0, z);
    if (k < 1) { obj.rotation.y = Math.atan2(to[0] - from[0], to[1] - from[1]); return true; } obj.rotation.y = face; return false;
  };
  const refMove = walk(ref, [-22, 13], [0, 8.2], 0.4, 4.6, 0);
  const aMove = walk(actors[0], [-24.5, 13.5], [-1.6, 8.6], 0.8, 5.0, 0), bMove = walk(actors[1], [-26, 13.5], [1.6, 8.6], 1.0, 5.2, 0);
  setPose(ref, refMove ? poses.jog(t, 0.8) : poses.idle(t)); const ol = actors[0].userData.out, orr = actors[1].userData.out;
  setPose(ol, aMove ? poses.jog(t + 1, 1) : (t > 6.2 && t < 7.2 ? { ...poses.idle(t), aRx: -0.8, aRz: 0.6, eR: 1.2 } : poses.idle(t))); setPose(orr, bMove ? poses.jog(t + 2, 1) : (t > 6.2 && t < 7.2 ? { ...poses.idle(t), aLx: -0.8, aLz: 0.6, eL: 1.2 } : poses.idle(t)));
  actors[0].userData.gk.visible = false; actors[1].userData.gk.visible = false;
  ballMesh.position.set(0, C.BR, C.SPOT_Z); ballShadow.position.set(0, 0.01, C.SPOT_Z);
  // camera script
  let cp, cl, fov = 50;
  if (t < 3.2) { const k = ease(t / 3.2); cp = [lerp(-26, -6, k), lerp(14, 2.6, k), lerp(42, 24, k)]; cl = [lerp(0, -3, k), 1.4, lerp(8, 10, k)]; }
  else if (t < 7.0) { const k = (t - 3.2) / 3.8; cp = [lerp(-2.2, 1.2, k), 1.45, lerp(16.2, 14.2, k)]; cl = [0, 1.25, 8.6]; fov = 44; }
  else { const k = ease(clamp((t - 7.0) / 3, 0, 1)); cp = [0, lerp(1.6, 1.8, k), lerp(14, 15.9, k)]; cl = [0, lerp(1.2, 1.15, k), lerp(8, 0.5, k)]; fov = lerp(44, 52, k); }
  camPos.set(cp[0], cp[1], cp[2]); camLook.set(cl[0], cl[1], cl[2]); cam.fov = fov * (Gfx.baseFov ? Gfx.baseFov / 52 : 1); cam.updateProjectionMatrix(); cam.position.copy(camPos); cam.lookAt(camLook);
  return true;
}
let lastT = performance.now(), spin = new THREE.Vector3();
Gfx.render = function () {
  if (!R) return; const nowP = performance.now(), dt = Math.min(0.05, (nowP - lastT) / 1000); lastT = nowP; const nowT = S.now();
  if (Gfx.Q) Gfx.Q.tick(nowP);
  boards.forEach(b => { b.offset.x = (nowP / 9000) % 1; });
  crowd.forEach((g, i) => { const c = S.cheer && nowT < S.cheer; g.position.y = Math.max(0, Math.sin(nowP / 1000 * (c ? 9 : 2.1) + i * 1.7)) * (c ? 0.4 : 0.05); });
  flashes.material.opacity = (S.cheer && nowT < S.cheer ? 0.9 : 0.25) * (Math.sin(nowP / 60) > 0.6 ? 1 : 0.2);
  updateNet(nowP);
  const intro = introUpdate(nowT);
  if (!intro) {
    placeActors(nowT, nowT);
    // ball
    let ballPos = null;
    if (S.replay) {
      const r = S.replay, tt = ((nowT - r.t0) / 1000) * r.speed; const b = r.s; let i = 0; while (i < b.length - 1 && b[i + 1][0] <= tt) i++; const a = b[i], c = b[i + 1];
      if (c) { const k = clamp((tt - a[0]) / (c[0] - a[0] || 1), 0, 1); ballPos = { x: lerp(a[1], c[1], k), y: lerp(a[2], c[2], k), z: lerp(a[3], c[3], k) }; } else ballPos = { x: a[1], y: a[2], z: a[3] };
      if (nowT > r.until) { S.replay = null; }
    } else if (S.strikeAt && nowT >= S.strikeAt) { const bp = ballFromBuffer((nowT - S.strikeAt) / 1000 - 0.1); if (bp) ballPos = bp; }
    if (ballPos) { const dx = ballPos.x - S.ball.x, dy = ballPos.y - S.ball.y, dz = ballPos.z - S.ball.z; const d = Math.hypot(dx, dy, dz); if (d > 1e-5) { const ax = new THREE.Vector3(dz, 0, -dx).normalize(); ballMesh.rotateOnWorldAxis(ax, d / C.BR); } S.ball.x = ballPos.x; S.ball.y = ballPos.y; S.ball.z = ballPos.z; }
    ballMesh.position.set(S.ball.x, S.ball.y, S.ball.z);
    ballShadow.position.set(S.ball.x, 0.012, S.ball.z); const hgt = clamp(S.ball.y / 3, 0, 1); ballShadow.scale.setScalar(1 - hgt * 0.5); ballShadow.material.opacity = 0.42 * (1 - hgt * 0.7);
    // trail
    if (S.strikeAt && nowT >= S.strikeAt && nowT < S.strikeAt + 1400) { trailPts.push([S.ball.x, S.ball.y, S.ball.z]); if (trailPts.length > 40) trailPts.shift(); } else if (trailPts.length) trailPts.shift();
    const ta = trail.geometry.attributes.position; for (let i = 0; i < 40; i++) { const p = trailPts[Math.min(i, trailPts.length - 1)] || [0, -9, 0]; ta.setXYZ(i, p[0], p[1], p[2]); } ta.needsUpdate = true; trail.geometry.setDrawRange(0, Math.max(0, trailPts.length)); trail.visible = trailPts.length > 1;
    // reticle
    reticle.visible = !!S.aim.show; if (S.aim.show) { reticle.position.set(S.aim.ax * C.HALF_W, Math.max(0.1, S.aim.ay * C.BAR_H), 0.08); reticle.scale.setScalar(1 + S.aim.power * 1.2 + Math.sin(nowP / 160) * 0.04); reticle.children[0].material.color.setHSL(0.33 - S.aim.power * 0.33, 1, 0.6); }
    // camera
    let mode = S.mode; if (S.replay) mode = S.replay.cam || 'goalcam';
    if (mode === 'menu') mode = 'default';
    const tg = camTarget(mode, nowP / 1000); camPos.lerp(tmpV.set(tg[0][0], tg[0][1], tg[0][2]), S.camSnap ? 1 : 0.075); const wanted = tmpV.set(tg[1][0], tg[1][1], tg[1][2]); camLook.lerp(wanted, S.camSnap ? 1 : 0.12); S.camSnap = false;
    const fov = tg[2] * (Gfx.baseFov ? Gfx.baseFov / 52 : 1); if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * 0.08; cam.updateProjectionMatrix(); }
    cam.position.copy(camPos); if (shake > 0.001) { cam.position.x += (Math.random() - .5) * shake; cam.position.y += (Math.random() - .5) * shake; shake *= 0.9; } cam.lookAt(camLook);
  }
  R.render(scene, cam);
};
Gfx.S = S;
window.PenGfx = Gfx;
})();
