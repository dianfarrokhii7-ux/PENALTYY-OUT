'use strict';
/*
 * AUREX PENALTY CUP – ball & goalkeeper physics.
 * One deterministic module used by the SERVER (it decides every result) and sent to the browser
 * (/aurex-pen-physics.js) so goalkeeper animation and visuals use exactly the same body model.
 *
 * World (metres): the goal line is the plane z = 0, the goal is centred on x = 0 and opens towards +z (the pitch).
 * The penalty mark is at z = 11. y is up. Ball: FIFA size 5 (r = 11 cm, 430 g).
 * Forces: gravity, quadratic air drag, Magnus-style curve, ground bounce + rolling friction,
 * goal posts and crossbar (cylinders, r = 6 cm), net, and a goalkeeper made of capsules.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AurexPenPhysics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const C = {
    G: 9.81, BR: 0.11, POST_R: 0.06, HALF_W: 3.66, BAR_H: 2.44, NET_D: 2.0, SPOT_Z: 11,
    DT: 1 / 240, SAMPLE_EVERY: 4, MAX_T: 5.0,
    KD: 0.0133,            // quadratic drag coefficient  (0.5·Cd·ρ·A / m)
    CURVE_A: 6.0,          // lateral acceleration at curve = ±1 and 25 m/s (m/s²)
    V_MIN: 13, V_RANGE: 10.5, // shot speed 13 … 23.5 m/s
    ENCROACH_LIMIT: 0.25,  // keeper may have a foot on / level with the line: anything further forward is encroachment (m)
    KEEPER_REACT: 0.04,    // push-off delay after the dive command (s)
    KEEPER_MAX_X: 3.0, KEEPER_MAX_Z: 1.2,
    RUNUP_MS: 720, FEINT_DELAY_MS: 380,
    FEINT_LEGAL_BELOW: 0.60, FEINT_GREY_BELOW: 0.72, FEINT_VAR_SPLIT: 0.66,
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const hyp = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

  /* ------------------------------------------------------------------ goalkeeper */
  const DIVES = {
    // T = time of the dive (s), D = sideways distance of the body centre (m), phi = final body tilt from vertical, y0/y1 = centre height start/end (m)
    low:  { T: 0.30, D: 2.10, phi: 84 * Math.PI / 180, y0: 0.95, y1: 0.65, arc: 0.20 },
    high: { T: 0.34, D: 1.70, phi: 58 * Math.PI / 180, y0: 0.95, y1: 1.55, arc: 0.20 },
    jump: { T: 0.32, D: 0,    phi: 0,                  y0: 0.95, y1: 1.40, arc: 0.12 },
  };
  function diveKind(dive) {
    if (!dive || (!dive.dir && !dive.hi)) return null;
    return dive.dir === 0 ? 'jump' : dive.hi ? 'high' : 'low';
  }
  /** k = { x, kz, dive: null | { dir:-1|0|1, hi:bool, at:seconds relative to the strike } }, t = seconds since the strike. */
  function keeperPose(k, t) {
    const kind = diveKind(k.dive);
    const pose = { cx: k.x, cy: 0.95, cz: k.kz || 0, ux: 0, uy: 1, spread: 1, ext: 0, s: 0, kind };
    if (!kind) return pose;
    const d = DIVES[kind], el = (t - k.dive.at - C.KEEPER_REACT) / d.T;
    if (el <= 0) return pose;
    const s = clamp(el, 0, 1), e = 1 - (1 - s) * (1 - s);              // fast push-off, slow finish
    const dir = k.dive.dir || 0, phi = d.phi * e;
    pose.cx = k.x + dir * d.D * e;
    pose.cy = d.y0 + (d.y1 - d.y0) * e + d.arc * Math.sin(Math.PI * s);
    pose.ux = dir * Math.sin(phi); pose.uy = Math.cos(phi);
    pose.spread = kind === 'jump' ? 1 - 0.25 * e : 1 - e; pose.ext = e; pose.s = s;
    return pose;
  }
  /** Capsules (segment + radius) that make the keeper's body at a pose. kind: 'body' | 'arms' | 'hands'. */
  function keeperCapsules(p) {
    const z = p.cz, ux = p.ux, uy = p.uy, px = uy, py = -ux;            // u = body axis, perp = arm axis (both in the x/y plane)
    const hl = 0.95, sh = 0.55;
    const out = [
      { kind: 'body', a: [p.cx - ux * hl, p.cy - uy * hl, z], b: [p.cx + ux * hl, p.cy + uy * hl, z], r: 0.34 },
      { kind: 'arms', a: [p.cx + ux * sh - px * 0.85 * p.spread, p.cy + uy * sh - py * 0.85 * p.spread, z], b: [p.cx + ux * sh + px * 0.85 * p.spread, p.cy + uy * sh + py * 0.85 * p.spread, z], r: 0.20 },
    ];
    if (p.ext > 0.05) { const h = hl + 0.55 * p.ext; out.push({ kind: 'hands', a: [p.cx + ux * hl, p.cy + uy * hl, z], b: [p.cx + ux * h, p.cy + uy * h, z], r: 0.30 }); }
    return out;
  }
  function closestOnSeg(a, b, p) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const L = abx * abx + aby * aby + abz * abz;
    let t = L > 1e-12 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / L : 0; t = clamp(t, 0, 1);
    return [a[0] + abx * t, a[1] + aby * t, a[2] + abz * t, t];
  }

  /* ------------------------------------------------------------------ launch */
  function randn(rng) { const u = Math.max(1e-9, rng()), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function accel(v, curve, out) {
    const sp = hyp(v[0], v[1], v[2]);
    out[0] = -C.KD * sp * v[0]; out[1] = -C.G - C.KD * sp * v[1]; out[2] = -C.KD * sp * v[2];
    if (curve) { const vh = Math.hypot(v[0], v[2]); if (vh > 1e-3) { const m = C.CURVE_A * curve * (vh / 25) / vh; out[0] += -v[2] * m; out[2] += v[0] * m; } }
  }
  /** Fly freely (no goal, no ground) until the plane z = 0 and return { x, y, t } there. */
  function freeFlightToGoalPlane(v0, curve) {
    const p = [0, C.BR, C.SPOT_Z], v = v0.slice(), a = [0, 0, 0]; let t = 0;
    for (let i = 0; i < 2400; i++) {
      accel(v, curve, a); v[0] += a[0] * C.DT; v[1] += a[1] * C.DT; v[2] += a[2] * C.DT;
      const pz = p[2]; p[0] += v[0] * C.DT; p[1] += v[1] * C.DT; p[2] += v[2] * C.DT; t += C.DT;
      if (p[2] <= 0) { const f = pz / (pz - p[2] || 1); return { x: p[0] - v[0] * C.DT * (1 - f), y: p[1] - v[1] * C.DT * (1 - f), t }; }
    }
    return null;
  }
  /**
   * input = { ax, ay, pw, curve }: aim in goal units (ax = ±1 is the post line, ay = 1 is the crossbar), power 0.2…1, curve -1…1.
   * The ball is aimed so that it passes the goal plane at the aimed point (including drag and curve), plus a random
   * error that grows with power (the classic power-vs-accuracy trade-off).
   */
  function launch(input, rng = Math.random) {
    const pw = clamp(+input.pw || 0, 0.2, 1), curve = clamp(+input.curve || 0, -1, 1);
    const ax = clamp(+input.ax || 0, -1.4, 1.4), ay = clamp(+input.ay || 0, 0, 1.45);
    const sx = 0.08 + 0.55 * Math.pow(pw, 2.5), sy = 0.06 + 0.40 * Math.pow(pw, 2.5);
    const ex = clamp(randn(rng), -2.2, 2.2) * sx, ey = clamp(randn(rng), -2.2, 2.2) * sy;
    const tx = ax * C.HALF_W + ex, ty = Math.max(0.12, ay * C.BAR_H + ey);
    const speed = C.V_MIN + C.V_RANGE * pw;
    let dx = tx, dy = ty - C.BR, dz = -C.SPOT_Z; const tf = C.SPOT_Z / speed;
    let v = [dx / tf, (dy + 0.5 * C.G * tf * tf) / tf, dz / tf], n = hyp(v[0], v[1], v[2]); v = v.map(c => c / n * speed);
    for (let i = 0; i < 10; i++) {
      const hit = freeFlightToGoalPlane(v, curve); if (!hit) break;
      const errx = tx - hit.x, erry = ty - hit.y; if (Math.abs(errx) < 0.003 && Math.abs(erry) < 0.003) break;
      v[0] += 0.9 * errx / hit.t; v[1] += 0.9 * erry / hit.t; n = hyp(v[0], v[1], v[2]); v = v.map(c => c / n * speed);
    }
    return { vel: v, speed, curve, aim: { x: ax * C.HALF_W, y: ay * C.BAR_H }, actual: { x: tx, y: ty } };
  }

  /* ------------------------------------------------------------------ simulation */
  /**
   * opt = { vel:[x,y,z], curve, keeper:{ x, kz, dive } }
   * -> { outcome:'goal'|'save'|'post'|'miss', samples:[[t,x,y,z]…@60 Hz], events:[…], crossing, clearance, minZ, woodwork, keeperTouch, endT }
   */
  function simulate(opt) {
    const keeper = opt.keeper || { x: 0, kz: 0, dive: null };
    const p = [0, C.BR, C.SPOT_Z], v = opt.vel.slice(), a = [0, 0, 0];
    let curve = opt.curve || 0, t = 0, step = 0;
    const samples = [[0, p[0], p[1], p[2]]], events = [];
    let crossing = null, clearance = null, goal = false, minZ = Infinity, woodwork = false, keeperTouch = null, held = false;
    let tEnd = C.MAX_T, lastWood = -1, lastKeeper = -1, lastNet = -1, lastGround = -1, inNetSeen = false;
    const rec = () => samples.push([+t.toFixed(4), +p[0].toFixed(3), +p[1].toFixed(3), +p[2].toFixed(3)]);

    for (; t < C.MAX_T && t < tEnd; ) {
      if (held) { const kp = keeperPose(keeper, t), h = keeperCapsules(kp).find(c => c.kind === 'hands') || keeperCapsules(kp)[0]; p[0] = h.b[0]; p[1] = h.b[1] - 0.1; p[2] = h.b[2] + C.BR * 0.8; v[0] = v[1] = v[2] = 0; }
      else {
        accel(v, curve, a);
        if (p[2] < 0 && Math.abs(p[0]) < C.HALF_W && p[1] < C.BAR_H) { a[0] -= 9 * v[0]; a[1] -= 9 * v[1]; a[2] -= 9 * v[2]; }   // net drag
        if (p[1] <= C.BR + 0.002 && Math.abs(v[1]) < 0.3) { const hs = Math.hypot(v[0], v[2]); if (hs > 0) { const dec = Math.min(hs, 0.9 * C.DT); v[0] -= v[0] / hs * dec; v[2] -= v[2] / hs * dec; } }  // rolling friction
        v[0] += a[0] * C.DT; v[1] += a[1] * C.DT; v[2] += a[2] * C.DT;
        const pz0 = p[2];
        p[0] += v[0] * C.DT; p[1] += v[1] * C.DT; p[2] += v[2] * C.DT; t += C.DT; step++;

        // ground
        if (p[1] < C.BR) {
          p[1] = C.BR;
          if (v[1] < -0.6) { v[1] = -v[1] * 0.62; v[0] *= 0.94; v[2] *= 0.94; curve *= 0.5; if (t - lastGround > 0.05) events.push({ t: +t.toFixed(3), type: 'bounce', x: +p[0].toFixed(2), z: +p[2].toFixed(2), s: +Math.abs(v[1]).toFixed(1) }); lastGround = t; }
          else v[1] = 0;
        }
        // posts + crossbar (cylinders)
        const yy = clamp(p[1], 0, C.BAR_H);
        const woods = [
          { kind: 'post', c: [C.HALF_W, yy, 0] }, { kind: 'post', c: [-C.HALF_W, yy, 0] },
          { kind: 'bar', c: [clamp(p[0], -C.HALF_W, C.HALF_W), C.BAR_H, 0] },
        ];
        for (const w of woods) {
          const dx = p[0] - w.c[0], dy = p[1] - w.c[1], dz = p[2] - w.c[2], d = hyp(dx, dy, dz), need = C.BR + C.POST_R;
          if (d < need && d > 1e-9) {
            const nx = dx / d, ny = dy / d, nz = dz / d, vn = v[0] * nx + v[1] * ny + v[2] * nz;
            p[0] = w.c[0] + nx * need; p[1] = w.c[1] + ny * need; p[2] = w.c[2] + nz * need;
            if (vn < 0) {
              const sp = hyp(v[0], v[1], v[2]); v[0] -= 1.55 * vn * nx; v[1] -= 1.55 * vn * ny; v[2] -= 1.55 * vn * nz; curve = 0;
              if (t - lastWood > 0.04) { woodwork = true; events.push({ t: +t.toFixed(3), type: w.kind, s: +sp.toFixed(1), x: +p[0].toFixed(2), y: +p[1].toFixed(2) }); }
              lastWood = t; tEnd = Math.min(tEnd, t + 1.6);
            }
          }
        }
        // net (box behind the line)
        if (p[2] < 0 && Math.abs(p[0]) < C.HALF_W + 0.05 && p[1] < C.BAR_H + 0.05) {
          let hit = false;
          if (p[2] < -C.NET_D + C.BR) { p[2] = -C.NET_D + C.BR; if (v[2] < 0) { v[2] *= -0.08; hit = true; } }
          if (Math.abs(p[0]) > C.HALF_W - C.BR) { p[0] = Math.sign(p[0]) * (C.HALF_W - C.BR); if (v[0] * Math.sign(p[0]) > 0) { v[0] *= -0.08; hit = true; } }
          if (p[1] > C.BAR_H - C.BR && p[2] < -0.1) { p[1] = C.BAR_H - C.BR; if (v[1] > 0) { v[1] *= -0.08; hit = true; } }
          if (hit && t - lastNet > 0.08) { events.push({ t: +t.toFixed(3), type: 'net', x: +p[0].toFixed(2), y: +p[1].toFixed(2), z: +p[2].toFixed(2) }); lastNet = t; }
          inNetSeen = true;
        }
        // goalkeeper
        if (!held && t - lastKeeper > 0.04) {
          const kp = keeperPose(keeper, t), caps = keeperCapsules(kp);
          let best = null;
          for (const c of caps) {
            const q = closestOnSeg(c.a, c.b, p), dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2], d = hyp(dx, dy, dz);
            if (d < C.BR + c.r && (!best || d - c.r < best.d - best.c.r)) best = { c, q, dx, dy, dz, d };
          }
          if (best) {
            const kp2 = keeperPose(keeper, t + 0.01), vk = [(kp2.cx - kp.cx) / 0.01, (kp2.cy - kp.cy) / 0.01, 0];
            let nx = best.dx, ny = best.dy, nz = best.dz; const d = best.d || 1e-6; nx /= d; ny /= d; nz /= d;
            const rv = [v[0] - vk[0], v[1] - vk[1], v[2] - vk[2]], vn = rv[0] * nx + rv[1] * ny + rv[2] * nz;
            if (vn < 0) {
              const sp = hyp(rv[0], rv[1], rv[2]), handsy = best.c.kind !== 'body';
              p[0] = best.q[0] + nx * (C.BR + best.c.r + 0.002); p[1] = best.q[1] + ny * (C.BR + best.c.r + 0.002); p[2] = best.q[2] + nz * (C.BR + best.c.r + 0.002);
              if (!keeperTouch) keeperTouch = { t: +t.toFixed(3), x: +p[0].toFixed(2), y: +p[1].toFixed(2), z: +p[2].toFixed(2), part: best.c.kind };
              if (handsy && sp <= 16 && p[2] > -C.BR) { held = true; events.push({ t: +t.toFixed(3), type: 'catch', x: +p[0].toFixed(2), y: +p[1].toFixed(2) }); tEnd = Math.min(tEnd, t + 0.5); }
              else {
                // glove / body contact: normal bounce with low restitution and strong tangential grip (the keeper is a heavy, soft body)
                const e = handsy ? 0.45 : 0.28, fr = handsy ? 0.30 : 0.40;
                const tx = rv[0] - vn * nx, ty = rv[1] - vn * ny, tz = rv[2] - vn * nz;
                v[0] = vk[0] + tx * fr - e * vn * nx; v[1] = vk[1] + ty * fr - e * vn * ny; v[2] = vk[2] + tz * fr - e * vn * nz; curve = 0;
                events.push({ t: +t.toFixed(3), type: 'parry', s: +sp.toFixed(1), part: best.c.kind, x: +p[0].toFixed(2), y: +p[1].toFixed(2) });
                if (v[2] > 0.5) tEnd = Math.min(tEnd, t + 0.9);        // pushed back into play – the kick is over
              }
              lastKeeper = t; tEnd = Math.min(tEnd, t + 2.2);
            }
          }
        }
        // goal line + minimum depth
        if (p[2] < minZ && !crossing) minZ = p[2];
        if (!crossing && p[2] <= 0 && pz0 > 0) {
          const f = pz0 / (pz0 - p[2] || 1), cx = p[0] - v[0] * C.DT * (1 - f), cy = p[1] - v[1] * C.DT * (1 - f);
          clearance = Math.min(C.HALF_W - C.POST_R - C.BR - Math.abs(cx), C.BAR_H - C.POST_R - C.BR - cy);
          events.push({ t: +t.toFixed(3), type: 'line', x: +cx.toFixed(3), y: +cy.toFixed(3), clearance: +clearance.toFixed(3) });
        }
        if (!crossing && p[2] <= -C.BR) {
          const inside = Math.abs(p[0]) <= C.HALF_W - C.POST_R && p[1] <= C.BAR_H - C.POST_R;
          crossing = { t: +t.toFixed(3), x: +p[0].toFixed(3), y: +p[1].toFixed(3), inside };
          if (inside) { goal = true; events.push({ t: +t.toFixed(3), type: 'goal' }); }
          tEnd = Math.min(tEnd, t + (inside ? 1.0 : 0.8));
        }
        // dead ball
        if (!held && p[1] <= C.BR + 0.002 && hyp(v[0], v[1], v[2]) < 0.05) tEnd = Math.min(tEnd, t + 0.3);
        if (p[2] > C.SPOT_Z + 4 || Math.abs(p[0]) > 30) tEnd = Math.min(tEnd, t + 0.2);
      }
      if (held) t += C.DT;
      if (step % C.SAMPLE_EVERY === 0 || held) { if (!held || Math.round(t / C.DT) % C.SAMPLE_EVERY === 0) rec(); }
    }
    rec();
    const outcome = goal ? 'goal' : keeperTouch ? 'save' : woodwork ? 'post' : 'miss';
    return { outcome, samples, events, crossing, clearance, minZ: minZ === Infinity ? C.SPOT_Z : +minZ.toFixed(3), woodwork, keeperTouch, held, endT: +Math.min(t, C.MAX_T).toFixed(3), inNet: inNetSeen };
  }

  return { C, clamp, keeperPose, keeperCapsules, diveKind, launch, simulate, freeFlightToGoalPlane };
});
