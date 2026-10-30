// PENALTY OUT — online 5v5 friendly match. Server-authoritative simulation on socket.io namespace /friendly.
const L = 25, W = 15, GW = 2.5, HALF = 150, DT = 1 / 30, BR = .18;
const FORMS = {
  '2-1-1': [[-.92, 0], [-.55, -.45], [-.55, .45], [-.1, 0], [.45, 0]],
  '1-2-1': [[-.92, 0], [-.55, 0], [-.1, -.55], [-.1, .55], [.45, 0]],
  '1-1-2': [[-.92, 0], [-.55, 0], [-.15, 0], [.45, -.4], [.45, .4]]
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), hyp = Math.hypot, rnd = Math.random, rd = v => Math.round(v * 100) / 100;
const dirOf = (r, t) => (t ? -1 : 1) * (r.flip ? -1 : 1);

function mk(code) {
  return { code, sk: [null, null], tok: [null, null], on: [false, false], team: ['BAR', 'RMA'], rdy: [false, false],
    lu: [{ form: '2-1-1', order: [0, 1, 2, 3, 4] }, { form: '2-1-1', order: [0, 1, 2, 3, 4] }], ph: 'lobby', flip: false,
    score: [0, 0], clock: HALF, half: 1, ctrl: [4, 9], inp: [{ mx: 0, mz: 0, sp: 0 }, { mx: 0, mz: 0, sp: 0 }], P: [],
    ball: { x: 0, y: BR, z: 0, vx: 0, vy: 0, vz: 0, o: -1, rt: 0 }, last: 0, rs: null, pt: 0, ev: [], chase: [-1, -1] };
}
function start(r) {
  r.P = []; for (let t = 0; t < 2; t++) for (let s = 0; s < 5; s++) r.P.push({ i: t * 5 + s, t, s, x: 0, z: 0, vx: 0, vz: 0, fx: dirOf(r, t), fz: 0, st: 0, stt: 0, tk: 0, kk: 0, stun: 0, y: 0, red: false, hit: false, th: 0, hold: 0 });
  r.score = [0, 0]; r.half = 1; r.clock = HALF; r.flip = false; r.ctrl = [4, 9]; kickoff(r, 0);
}
function place(r) {
  for (const p of r.P) { if (p.red) continue; const d = dirOf(r, p.t), f = FORMS[r.lu[p.t].form][p.s];
    p.x = Math.min(f[0], -.12) * L * d; p.z = f[1] * W; p.vx = p.vz = 0; p.fx = d; p.fz = 0; p.st = 0; }
}
function kickoff(r, t) { place(r); setRestart(r, 'kickoff', t, 0, 0); }
function setRestart(r, type, t, x, z) {
  const B = r.ball, d = dirOf(r, t); B.x = x; B.z = z; B.y = BR; B.vx = B.vz = B.vy = 0; B.o = -1; r.ph = 'dead';
  let tk = null, bd = 1e9;
  for (const q of r.P) if (q.t === t && !q.red && (type === 'goalkick' ? q.s === 0 : q.s > 0)) { const dd = hyp(q.x - x, q.z - z); if (dd < bd) { bd = dd; tk = q; } }
  if (!tk) tk = r.P.find(q => q.t === t && !q.red);
  const fx = type === 'throwin' ? 0 : d, fz = type === 'throwin' ? -Math.sign(z) : 0;
  tk.fx = fx; tk.fz = fz; tk.x = x - fx * .8; tk.z = z - fz * .8; tk.vx = tk.vz = 0;
  r.rs = { type, team: t, taker: tk.i, t: 0, x, z };
  if (r.on[t]) r.ctrl[t] = tk.i;
  r.ev.push({ k: 'restart', type, t });
}
function kick(r, p, vx, vz, vy) {
  const B = r.ball; B.o = -1; B.vx = vx; B.vz = vz; B.vy = vy; B.rt = 0; r.last = p.t; p.kk = .35; p.st = 2; p.stt = .25;
  if (r.ph === 'dead') { r.ph = 'play'; r.rs = null; }
  r.ev.push({ k: 'kick' });
}
function pass(r, p, dx, dz) {
  let n = hyp(dx, dz); if (n < .2) { dx = p.fx; dz = p.fz; n = 1; } dx /= n; dz /= n;
  let best = null, bs = .45;
  for (const q of r.P) if (q.t === p.t && q !== p && !q.red) {
    const ex = q.x - p.x, ez = q.z - p.z, dd = hyp(ex, ez) || 1, c = (ex * dx + ez * dz) / dd, s = c - dd * .012;
    if (c > .55 && s > bs) { bs = s; best = q; }
  }
  const B = r.ball; let tx, tz, sp;
  if (best) { const dd = hyp(best.x - p.x, best.z - p.z); tx = best.x + best.vx * .35; tz = best.z + best.vz * .35; sp = clamp(7 + dd * 1.1, 9, 19); if (r.on[p.t] && r.ctrl[p.t] === p.i && best.s) r.ctrl[p.t] = best.i; }
  else { tx = B.x + dx * 12; tz = B.z + dz * 12; sp = 11; }
  const ex = tx - B.x, ez = tz - B.z, e = hyp(ex, ez) || 1; kick(r, p, ex / e * sp, ez / e * sp, 0);
}
function shoot(r, p, pw, az) {
  const B = r.ball, gx = dirOf(r, p.t) * L, j = (rnd() - .5) * pw * pw * 1.6, ex = gx - B.x, ez = clamp(az + j, -3.2, 3.2) - B.z, e = hyp(ex, ez) || 1, sp = 13 + pw * 15;
  kick(r, p, ex / e * sp, ez / e * sp, 1.2 + pw * 3.2);
}
function tackle(r, p) { if (p.tk > 0 || p.st === 1 || p.red || p.stun > 0) return; p.st = 1; p.stt = .4; p.tk = 1.3; p.hit = false; r.ev.push({ k: 'tackle' }); }
function foul(r, p, v, behind) {
  const d = dirOf(r, p.t); let card = null;
  if (behind && rnd() < .35) { p.y++; card = p.y >= 2 ? 'r' : 'y'; }
  if (rnd() < .04) card = 'r';
  if (card === 'r') { p.red = true; if (r.on[p.t] && r.ctrl[p.t] === p.i) swit(r, p.t); }
  const inBox = -d * v.x > L - 8 && Math.abs(v.z) < 7, dv = dirOf(r, v.t);
  r.ev.push({ k: 'foul', t: p.t, i: p.i, card, pen: inBox });
  if (card === 'r') { p.x = 0; p.z = W + 4; }
  if (inBox) setRestart(r, 'penalty', v.t, dv * (L - 6), 0); else setRestart(r, 'freekick', v.t, clamp(v.x, -L + 1, L - 1), clamp(v.z, -W + 1, W - 1));
}
function swit(r, t) {
  const B = r.ball; let best = null, bd = 1e9;
  for (const q of r.P) if (q.t === t && q.s > 0 && !q.red && q.i !== r.ctrl[t]) { const dd = hyp(q.x - B.x, q.z - B.z); if (dd < bd) { bd = dd; best = q; } }
  if (best) r.ctrl[t] = best.i;
}
function act(r, t, a) {
  const p = r.P[r.ctrl[t]]; if (!p || p.red || !['play', 'dead'].includes(r.ph)) return; const B = r.ball, i = r.inp[t];
  if (a.t === 'sw') return swit(r, t);
  const can = B.o === p.i || (r.ph === 'dead' && r.rs && r.rs.taker === p.i);
  if (can && a.t === 'pass') pass(r, p, i.mx, i.mz);
  else if (can && a.t === 'shoot') shoot(r, p, clamp(+a.p || .5, .2, 1), clamp(i.mz * 2.4, -2.2, 2.2));
  else if (!can && a.t === 'tk') tackle(r, p);
}
function aim(p, tx, tz, sp) { const dx = tx - p.x, dz = tz - p.z, n = hyp(dx, dz); return n < .35 || !sp ? [0, 0] : [dx / n * sp * Math.min(1, n / 1.5), dz / n * sp * Math.min(1, n / 1.5)]; }
function ai(r, p) {
  const B = r.ball, d = dirOf(r, p.t), dead = r.ph === 'dead', rs = r.rs;
  if (dead && rs.taker === p.i) return [0, 0];
  const opp = r.P.filter(q => q.t !== p.t && !q.red), f = FORMS[r.lu[p.t].form][p.s];
  if (p.s === 0) {
    let tz = clamp(B.z * .45, -GW, GW); const toward = B.vx * -d > 1.5 && B.o < 0;
    if (toward && B.rt > .22) { const t = (-d * L - B.x) / B.vx; if (t > 0 && t < 2) tz = clamp(B.z + B.vz * t, -GW, GW); }
    if (B.o === p.i && r.ph === 'play') { p.hold -= DT; if (p.hold <= 0) pass(r, p, d, 0); return [0, 0]; }
    return aim(p, -d * (L - 1.3), tz, toward ? 5 : 4);
  }
  if (B.o === p.i && r.ph === 'play') {
    p.th -= DT; const gx = d * L;
    if (p.th <= 0) {
      p.th = .4 + rnd() * .3;
      if (hyp(gx - p.x, p.z) < 10 && rnd() < .4) { shoot(r, p, .6 + rnd() * .35, clamp(-r.P[(1 - p.t) * 5].z + (rnd() < .5 ? -1.6 : 1.6), -2.2, 2.2)); return [0, 0]; }
      if (opp.some(q => hyp(q.x - p.x, q.z - p.z) < 2.3) && rnd() < .7) { pass(r, p, d, (rnd() - .5) * .8); return [0, 0]; }
    }
    let sx = gx - p.x, sz = -p.z * .6; const n = hyp(sx, sz) || 1; sx /= n; sz /= n;
    for (const q of opp) { const ex = q.x - p.x, ez = q.z - p.z; if (hyp(ex, ez) < 3 && ex * sx + ez * sz > 0) { sx += -ez * .06 * Math.sign(ex * sz - ez * sx || 1); sz += ex * .06 * Math.sign(ex * sz - ez * sx || 1); } }
    return aim(p, p.x + sx * 5, p.z + sz * 5, 6);
  }
  const theirs = B.o >= 0 && r.P[B.o].t !== p.t;
  if (!dead && r.chase[p.t] === p.i) {
    const tgt = theirs ? r.P[B.o] : B, lead = theirs ? 0 : .3;
    if (theirs && hyp(tgt.x - p.x, tgt.z - p.z) < 1.4 && p.tk <= 0 && rnd() < .025) tackle(r, p);
    return aim(p, tgt.x + (tgt.vx || 0) * lead, tgt.z + (tgt.vz || 0) * lead, 6.6);
  }
  let tx = clamp(f[0] * L * d + B.x * .3, -L + 2, L - 2), tz = clamp(f[1] * W + B.z * .3, -W + 1, W - 1);
  if (dead && p.t !== rs.team && hyp(tx - B.x, tz - B.z) < 6) { const n = hyp(p.x - B.x, p.z - B.z) || 1; tx = B.x + (p.x - B.x) / n * 6; tz = B.z + (p.z - B.z) / n * 6; }
  return aim(p, tx, tz, 5.6);
}
function end(r, scorer) {
  r.score[scorer]++; r.ph = 'goal'; r.pt = 3.2; r.ev.push({ k: 'goal', t: scorer, score: [...r.score] }); r.after = () => kickoff(r, 1 - scorer);
}
function tick(r) {
  if (!['play', 'dead', 'goal'].includes(r.ph)) return; const B = r.ball;
  if (r.ph === 'goal') { r.pt -= DT; if (r.pt <= 0 && r.after) { const f = r.after; r.after = null; f(); } }
  else {
    r.clock -= DT;
    if (r.clock <= 0 && r.ph === 'play') {
      if (r.half === 1) { r.half = 2; r.clock = HALF; r.flip = true; r.ph = 'goal'; r.pt = 3.5; r.ev.push({ k: 'half' }); r.after = () => kickoff(r, 1); }
      else { r.ph = 'end'; r.ev.push({ k: 'end', score: [...r.score] }); return; }
    }
  }
  if (r.ph === 'dead') { r.rs.t += DT; const t = r.rs.team, tk = r.P[r.rs.taker], hum = r.on[t] && r.ctrl[t] === tk.i;
    if (r.rs.t > (hum ? 9 : 1.6)) { const d = dirOf(r, t), ty = r.rs.type; if (ty === 'penalty' || (ty === 'freekick' && hyp(d * L - B.x, B.z) < 14)) shoot(r, tk, .75, (rnd() < .5 ? -1.7 : 1.7)); else pass(r, tk, d, (rnd() - .5) * .6); } }
  for (let t = 0; t < 2; t++) { let b = -1, bd = 1e9; for (const q of r.P) if (q.t === t && q.s > 0 && !q.red && !(r.on[t] && r.ctrl[t] === q.i)) { const dd = hyp(q.x - B.x, q.z - B.z); if (dd < bd) { bd = dd; b = q.i; } } r.chase[t] = b; }
  for (const p of r.P) {
    if (p.red) continue; p.tk = Math.max(0, p.tk - DT); p.kk = Math.max(0, p.kk - DT); p.stun = Math.max(0, p.stun - DT);
    let wx = 0, wz = 0; const human = r.on[p.t] && r.ctrl[p.t] === p.i, i = r.inp[p.t];
    if (r.ph === 'goal') { /* celebrate */ }
    else if (human) {
      const n = hyp(i.mx, i.mz), frozen = r.ph === 'dead' && r.rs.taker === p.i;
      if (n > .1) { if (frozen) { p.fx = i.mx / n; p.fz = i.mz / n; } else { const s = (i.sp ? 7.6 : 6) * Math.min(1, n) * (B.o === p.i ? .93 : 1); wx = i.mx / n * s; wz = i.mz / n * s; } }
    } else { const a = ai(r, p); wx = a[0]; wz = a[1]; }
    if (p.st === 1) { p.stt -= DT; if (p.stt <= 0) p.st = 0; const k = p.stt > .12 ? 8.5 : 2; wx = p.fx * k; wz = p.fz * k; }
    else if (p.st === 2) { p.stt -= DT; if (p.stt <= 0) p.st = 0; }
    if (p.stun > 0) { wx *= .2; wz *= .2; }
    p.vx += (wx - p.vx) * Math.min(1, DT * 9); p.vz += (wz - p.vz) * Math.min(1, DT * 9);
    p.x = clamp(p.x + p.vx * DT, -L - 3, L + 3); p.z = clamp(p.z + p.vz * DT, -W - 2, W + 2);
    const sp = hyp(p.vx, p.vz);
    if (sp > .8 && p.st !== 1) { const tx = p.vx / sp, tz = p.vz / sp; p.fx += (tx - p.fx) * Math.min(1, DT * 10); p.fz += (tz - p.fz) * Math.min(1, DT * 10); const n = hyp(p.fx, p.fz) || 1; p.fx /= n; p.fz /= n; }
    if (p.st === 1 && !p.hit && B.o >= 0 && r.P[B.o].t !== p.t && hyp(r.P[B.o].x - p.x, r.P[B.o].z - p.z) < 1.1) {
      p.hit = true; const v = r.P[B.o], behind = p.fx * v.fx + p.fz * v.fz > .4;
      if (rnd() < (behind ? .75 : .25)) { foul(r, p, v, behind); return; }
      B.o = -1; B.vx = p.fx * 6 + (rnd() - .5) * 3; B.vz = p.fz * 6 + (rnd() - .5) * 3; B.vy = 1; v.stun = .5; r.last = p.t; r.ev.push({ k: 'win' });
    }
  }
  for (let a = 0; a < 10; a++) for (let b = a + 1; b < 10; b++) { const p = r.P[a], q = r.P[b]; if (p.red || q.red) continue; const dx = q.x - p.x, dz = q.z - p.z, dd = hyp(dx, dz); if (dd < .7 && dd > .001) { const k = (.7 - dd) / 2 / dd; p.x -= dx * k; p.z -= dz * k; q.x += dx * k; q.z += dz * k; } }
  /* ball */
  if (B.o >= 0) {
    const p = r.P[B.o]; if (p.red) { B.o = -1; } else { B.x = p.x + p.fx * .7; B.z = p.z + p.fz * .7; B.y = BR; B.vx = p.vx; B.vz = p.vz; B.vy = 0; }
  } else {
    B.rt += DT; B.vy -= 9.8 * DT; B.x += B.vx * DT; B.y += B.vy * DT; B.z += B.vz * DT;
    if (B.y < BR) { B.y = BR; B.vy = Math.abs(B.vy) > 1.2 ? -B.vy * .55 : 0; }
    const g = B.y <= BR + .01 ? 1.3 : .1; B.vx *= 1 - g * DT; B.vz *= 1 - g * DT;
    if (r.ph === 'goal' || (Math.abs(B.z) < GW + .3 && Math.abs(B.x) > L)) { if (Math.abs(B.x) > L + 2.2) { B.x = Math.sign(B.x) * (L + 2.2); B.vx *= -.1; } }
    if (r.ph === 'play') {
      for (const p of r.P) {
        if (p.red || p.kk > 0 || p.stun > 0) continue; const gk = p.s === 0, dd = hyp(p.x - B.x, p.z - B.z), sp = hyp(B.vx, B.vz);
        if (dd < (gk ? 1.15 : .8) && B.y < (gk ? 2.2 : .9)) {
          if (sp >= 22 && (!gk || rnd() < .45)) { if (gk) { B.vx *= -.35; B.vz += (rnd() - .5) * 6; B.vy = 2; r.last = p.t; r.ev.push({ k: 'save' }); break; } continue; }
          B.o = p.i; B.vx = B.vz = 0; r.last = p.t; p.hold = 1.2; if (gk) r.ev.push({ k: 'save' }); if (r.on[p.t] && p.s) r.ctrl[p.t] = p.i; break;
        }
      }
      if (B.o < 0) {
        if (Math.abs(B.x) > L) {
          const end_ = Math.sign(B.x);
          if (Math.abs(B.z) < GW && B.y < 2) end(r, dirOf(r, 0) === end_ ? 0 : 1);
          else { const def = dirOf(r, 0) === -end_ ? 0 : 1; if (r.last === def) setRestart(r, 'corner', 1 - def, end_ * L, Math.sign(B.z || 1) * W); else setRestart(r, 'goalkick', def, end_ * (L - 2), 0); }
        } else if (Math.abs(B.z) > W) setRestart(r, 'throwin', 1 - r.last, B.x, Math.sign(B.z) * W);
      }
    }
  }
}
function snap(r) {
  const B = r.ball;
  return { c: Math.ceil(r.clock), h: r.half, s: r.score, ph: r.ph, rs: r.rs ? { k: r.rs.type, t: r.rs.team } : null, fl: r.flip ? 1 : 0,
    b: [rd(B.x), rd(B.y), rd(B.z), B.o], p: r.P.map(p => [rd(p.x), rd(p.z), rd(Math.atan2(p.fz, p.fx)), p.st, p.red ? 1 : 0, rd(hyp(p.vx, p.vz)), p.y]), k: r.ctrl };
}

function attach(io) {
  const ns = io.of('/friendly'), rooms = {}; let queue = null;
  const tok = () => Math.random().toString(36).slice(2, 12), R = s => s.data && rooms[s.data.c];
  const pub = r => ({ code: r.code, on: r.on, team: r.team, rdy: r.rdy, ph: r.ph, lu: r.lu });
  const seat = (r, s, i) => { r.sk[i] = s.id; r.tok[i] = tok(); r.on[i] = true; s.join(r.code); s.data = { c: r.code, i }; s.emit('joined', { code: r.code, i, token: r.tok[i] }); ns.to(r.code).emit('room', pub(r)); };
  const mkRoom = () => { let c; do c = Math.random().toString(36).slice(2, 6).toUpperCase(); while (rooms[c]); return rooms[c] = mk(c); };
  const join = (s, r) => { const i = r.sk[0] ? (r.sk[1] ? -1 : 1) : 0; i < 0 ? s.emit('err', 'Room is full') : seat(r, s, i); };
  ns.on('connection', s => {
    s.on('create', () => seat(mkRoom(), s, 0));
    s.on('join', c => { const r = rooms[String(c).toUpperCase().trim()]; r ? join(s, r) : s.emit('err', 'Room not found'); });
    s.on('quick', () => { if (queue && rooms[queue] && !rooms[queue].sk[1]) { join(s, rooms[queue]); queue = null; } else { const r = mkRoom(); queue = r.code; seat(r, s, 0); } });
    s.on('rejoin', ({ code, token }) => {
      const r = rooms[code], i = r ? r.tok.indexOf(token) : -1; if (i < 0) return s.emit('err', 'Session expired');
      r.sk[i] = s.id; r.on[i] = true; s.join(code); s.data = { c: code, i }; s.emit('joined', { code, i, token }); ns.to(code).emit('room', pub(r));
      if (!['lobby', 'lineup'].includes(r.ph)) s.emit('start', { team: r.team, lu: r.lu });
    });
    s.on('team', t => { const r = R(s); if (!r || r.ph !== 'lobby' || r.rdy[s.data.i]) return; const i = s.data.i; if (r.rdy[1 - i] && r.team[1 - i] === t) return; r.team[i] = t === 'RMA' ? 'RMA' : 'BAR'; ns.to(r.code).emit('room', pub(r)); });
    s.on('lineup', d => {
      const r = R(s); if (!r || r.ph !== 'lineup' || r.rdy[s.data.i]) return; const o = d && d.order;
      if (FORMS[d && d.form] && Array.isArray(o) && o.length === 5 && [0, 1, 2, 3, 4].every(k => o.includes(k)) && o[0] === 0) r.lu[s.data.i] = { form: d.form, order: o.map(Number) };
    });
    s.on('ready', () => {
      const r = R(s); if (!r || !r.on[0] || !r.on[1]) return; r.rdy[s.data.i] = true;
      if (r.rdy[0] && r.rdy[1]) {
        if (r.ph === 'lobby') { if (r.team[0] === r.team[1]) r.team[1] = r.team[0] === 'BAR' ? 'RMA' : 'BAR'; r.ph = 'lineup'; r.rdy = [false, false]; }
        else if (r.ph === 'lineup') { start(r); ns.to(r.code).emit('start', { team: r.team, lu: r.lu }); }
      }
      ns.to(r.code).emit('room', pub(r));
    });
    s.on('in', d => { const r = R(s); if (r && d) r.inp[s.data.i] = { mx: clamp(+d.mx || 0, -1, 1), mz: clamp(+d.mz || 0, -1, 1), sp: d.sp ? 1 : 0 }; });
    s.on('act', a => { const r = R(s); if (r && a) act(r, s.data.i, a); });
    s.on('disconnect', () => {
      const r = R(s); if (!r || r.sk[s.data.i] !== s.id) return; r.on[s.data.i] = false; ns.to(r.code).emit('room', pub(r));
      setTimeout(() => { if (!r.on[0] && !r.on[1]) delete rooms[r.code]; }, 60000);
    });
  });
  setInterval(() => {
    for (const c in rooms) {
      const r = rooms[c]; if (!r.P.length) continue; tick(r);
      ns.to(c).volatile.emit('snap', snap(r)); if (r.ev.length) { ns.to(c).emit('ev', r.ev); r.ev = []; }
    }
  }, 1000 * DT);
}
module.exports = { attach, mk, start, tick, snap, FORMS };
