/* PENALTY OUT — shared data + helpers (loaded by the browser AND by the Node server).
 * Everything that must be identical on both sides lives here: squads, player ratings, the classic ball,
 * the player-name overlay and the adaptive-resolution controller. */
(function (root) {
  'use strict';

  /* ---------- squads & ratings ----------
   * P(name, number, PAC, SHO, PAS, DRI, DEF [, GK])  — ratings 1..99.
   * Squad index 0 is always the goalkeeper. The first 6 entries are the default starting XI,
   * the rest are the bench (they can be brought on in the line-up screen or during the match).
   * Ratings are approximations made for gameplay; edit freely. */
  const P = (n, num, pac, sho, pas, dri, def, gk) => ({ n, num, pac, sho, pas, dri, def, gk: gk || 0 });
  const SQUADS = {
    BAR: {
      n: 'BARCELONA', kit: ['#a50044', '#004d98'], r: [
        P('Joan García', 13, 50, 20, 60, 40, 30, 84),
        P('Lamine Yamal', 19, 92, 80, 84, 93, 35),
        P('Gerard Martín', 18, 78, 55, 74, 72, 78),
        P('Raphinha', 11, 86, 84, 82, 87, 45),
        P('Gavi', 6, 76, 66, 82, 82, 72),
        P('Pedri', 8, 74, 70, 90, 90, 66),
        P('Jules Koundé', 23, 82, 55, 76, 76, 86),
        P('Pau Cubarsí', 2, 70, 40, 82, 72, 85),
        P('Álvaro Cortés', 16, 74, 50, 68, 70, 70),
        P('Frenkie de Jong', 21, 78, 66, 88, 88, 76),
        P('Karim Adeyemi', 7, 94, 76, 68, 82, 35),
        P('Anthony Gordon', 17, 88, 78, 74, 84, 50)
      ]
    },
    RMA: {
      n: 'REAL MADRID', kit: ['#f6f6fa', '#d8c06a'], r: [
        P('Thibaut Courtois', 1, 48, 18, 62, 38, 30, 90),
        P('Antonio Rüdiger', 22, 80, 50, 66, 62, 87),
        P('Trent Alexander-Arnold', 12, 76, 74, 90, 78, 76),
        P('Eduardo Camavinga', 6, 80, 66, 82, 84, 82),
        P('Kylian Mbappé', 10, 97, 92, 80, 92, 36),
        P('Vinícius Júnior', 7, 95, 84, 80, 94, 30),
        P('Ferland Mendy', 23, 88, 52, 70, 74, 82),
        P('Raúl Asencio', 17, 72, 40, 66, 62, 80),
        P('David Jiménez', 24, 70, 42, 64, 62, 76),
        P('Federico Valverde', 15, 88, 82, 84, 82, 78)
      ]
    },
    MJ: {
      n: 'MASHIN JADID', kit: ['#111111', '#d4a017'], r: [
        P('Kairo', 1, 50, 25, 60, 45, 35, 86),
        P('Kalbas', 7, 82, 78, 72, 80, 50),
        P('Ryven', 10, 78, 82, 80, 84, 45),
        P('Bati', 9, 76, 76, 70, 70, 60),
        P('Ishin', 5, 74, 68, 74, 72, 70),
        P('Amir X Mod', 11, 88, 80, 76, 86, 40),
        P('Mohammad Gimer', 14, 82, 78, 74, 80, 60),
        P('Mohammad Iron', 3, 76, 70, 72, 70, 86),
        P('Parham Gameplay', 8, 85, 76, 84, 86, 58),
        P('Kiasha', 21, 90, 84, 70, 88, 40)
      ]
    }
  };
  const TEAM_KEYS = Object.keys(SQUADS);
  const ovr = p => p.gk ? p.gk : Math.round(p.pac * .2 + p.sho * .25 + p.pas * .2 + p.dri * .2 + p.def * .15);
  const sanitizeName = s => String(s == null ? '' : s).replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 14);

  /* Formations: 6 slots, slot 0 = goalkeeper; [depth, width] in -1..1 (own goal -> opponent goal, left -> right).
   * Single source of truth: used by the server simulation, the match client and the line-up editor. */
  const FORMS = {
    '2-2-1': [[-.92, 0], [-.55, -.45], [-.55, .45], [-.1, -.5], [-.1, .5], [.45, 0]],
    '2-1-2': [[-.92, 0], [-.55, -.45], [-.55, .45], [-.1, 0], [.45, -.4], [.45, .4]],
    '3-1-1': [[-.92, 0], [-.55, -.6], [-.55, 0], [-.55, .6], [-.1, 0], [.45, 0]],
    '1-3-1': [[-.92, 0], [-.55, 0], [-.1, -.6], [-.1, 0], [-.1, .6], [.45, 0]],
    '1-2-2': [[-.92, 0], [-.55, 0], [-.1, -.5], [-.1, .5], [.45, -.4], [.45, .4]]
  };
  const DEF_FORM = '2-2-1';
  const out = { SQUADS, TEAM_KEYS, ovr, sanitizeName, FORMS, DEF_FORM };

  /* ---------- browser-only helpers ---------- */
  if (typeof window !== 'undefined') {
    /* Classic black-and-white football (truncated icosahedron: 12 black pentagons on white).
     * Colours are baked into vertex colours, so it is cheap on mobile. */
    out.classicBall = function (THREE, R) {
      const t = (1 + Math.sqrt(5)) / 2;
      const V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(v => new THREE.Vector3(v[0], v[1], v[2]).normalize());
      const nb = V.map((v, i) => { let b = -1, bd = -2; V.forEach((w, j) => { if (j !== i && v.dot(w) > bd) { bd = v.dot(w); b = j; } }); return b; });
      const g = new THREE.SphereGeometry(R, 56, 40), pos = g.attributes.position, col = new Float32Array(pos.count * 3), p = new THREE.Vector3();
      const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), RI = .3, PI72 = Math.PI * 2 / 5;
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).normalize();
        let b = 0, bd = -2, sd = -2;
        for (let j = 0; j < 12; j++) { const d = p.dot(V[j]); if (d > bd) { sd = bd; bd = d; b = j; } else if (d > sd) sd = d; }
        const ang = Math.acos(Math.min(1, bd)), v = V[b], n = V[nb[b]];
        e1.copy(n).addScaledVector(v, -n.dot(v)).normalize(); e2.crossVectors(v, e1);
        let phi = Math.atan2(p.dot(e2), p.dot(e1)); phi = ((phi % PI72) + PI72) % PI72 - PI72 / 2;
        const edge = RI / Math.cos(phi), k = Math.max(0, Math.min(1, (edge - ang) / .035));
        const seam = Math.max(0, 1 - (Math.acos(Math.min(1, sd)) - ang) / .07) * (1 - k) * .3;
        const c = (.96 * (1 - k) + .05 * k) * (1 - seam);
        col[i * 3] = col[i * 3 + 1] = c; col[i * 3 + 2] = c * .985 + (k ? 0 : .01);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.Mesh(g, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 38, specular: 0x444444 }));
      return m;
    };

    /* Adaptive resolution: keeps ~50+ fps on phones by trading pixel ratio (never below `min`). */
    out.Quality = function (renderer, max, min, onFloor) {
      let pr = max, n = 0, t0 = performance.now(), hold = 0, floorHits = 0;
      renderer.setPixelRatio(pr);
      return {
        get pr() { return pr; },
        tick(now) {
          n++; if (now - t0 < 2000) return;
          const fps = n * 1000 / (now - t0); n = 0; t0 = now;
          if (document.hidden || fps < 5) return;
          if (hold > 0) { hold--; return; }
          if (fps < 42 && pr > min) { pr = Math.max(min, +(pr - .2).toFixed(2)); renderer.setPixelRatio(pr); dispatchEvent(new Event('resize')); hold = 1; }
          else if (fps < 36 && pr <= min && onFloor && ++floorHits >= 2) { onFloor(); onFloor = null; }
          else if (fps > 57 && pr < max) { pr = Math.min(max, +(pr + .1).toFixed(2)); renderer.setPixelRatio(pr); dispatchEvent(new Event('resize')); hold = 2; }
        }
      };
    };

    /* Player name (asked once, kept in localStorage, sent to the opponent). */
    const KEY = 'pof_name';
    out.name = () => { try { return sanitizeName(localStorage.getItem(KEY)); } catch (e) { return ''; } };
    out.askName = function (force, done) {
      const cur = out.name(); if (cur && !force) { done && done(cur); return; }
      if (!document.getElementById('pof-style')) {
        const st = document.createElement('style'); st.id = 'pof-style';
        st.textContent = '#pofName{position:fixed;inset:0;z-index:99;display:flex;align-items:center;justify-content:center;background:rgba(6,18,12,.96);padding:16px}#pofName .box{width:min(380px,100%);display:flex;flex-direction:column;gap:12px;text-align:center}#pofName h2{margin:0;font-size:32px}#pofName input{text-transform:none;letter-spacing:.05em;font-size:22px}#pofName .note{opacity:.7;margin:0}';
        document.head.appendChild(st);
      }
      const ov = document.createElement('div'); ov.id = 'pofName';
      ov.innerHTML = '<div class="box"><h2>YOUR NAME</h2><p class="note">Your opponent sees this name.</p><input id="pofIn" maxlength="14" placeholder="Username" autocomplete="off"><button class="big" id="pofGo">Continue</button></div>';
      document.body.appendChild(ov);
      const inp = ov.querySelector('#pofIn'), go = ov.querySelector('#pofGo'); inp.value = cur; setTimeout(() => inp.focus(), 50);
      const fin = () => { const v = sanitizeName(inp.value); if (v.length < 2) { inp.style.borderColor = '#e63946'; return; } try { localStorage.setItem(KEY, v); } catch (e) {} ov.remove(); done && done(v); };
      go.onclick = fin; inp.onkeydown = e => { if (e.key === 'Enter') fin(); };
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = out; else root.POF = out;
})(typeof window !== 'undefined' ? window : globalThis);
