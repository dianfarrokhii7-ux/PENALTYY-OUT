'use strict';
/*
 * AUREX PENALTY CUP – opening ceremony overlay (first league match of the cup).
 * Pure DOM + one 2D canvas (fireworks). No inline styles / handlers: the page CSP only allows 'self' styles, so everything is class- and CSSOM-driven.
 *   AurexCeremony.play(cer, { players, preMs, elapsedMs, crest, snd, onDone })   scenes are scheduled from the time left, so a late reporter sees the rest
 *   AurexCeremony.setReporters(names)                                            updates the "commentary" line live while the ceremony runs
 *   AurexCeremony.stop()                                                         hides everything (skip button, first kick, leaving)
 */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let timers = [], raf = 0, fx = [], cv = null, g = null, cur = null, last = 0;

  const later = (ms, fn) => { timers.push(setTimeout(fn, Math.max(0, ms))); };
  const scene = name => { const root = $('cer'); if (!root) return; root.querySelectorAll('.sc').forEach(e => e.classList.toggle('on', e.dataset.sc === name)); root.dataset.now = name; };
  const tint = (p, i) => { const c = p && p.team && p.team.club && p.team.club.colors && p.team.club.colors.length >= 2 ? p.team.club.colors : (i ? ['#d6336c', '#f5c84a'] : ['#1d4ed8', '#5b95ff']); return c; };

  /* ---------- fireworks + confetti on a 2D canvas above the 3D view ---------- */
  function resize() { if (!cv) return; const r = window.devicePixelRatio > 1.5 ? 1.5 : 1; cv.width = Math.floor(innerWidth * r); cv.height = Math.floor(innerHeight * r); }
  function burst(x, y, hue, n) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 1.2 + Math.random() * 4.2; fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, dec: 0.008 + Math.random() * 0.012, h: hue + Math.random() * 30 - 15, s: 1 + Math.random() * 2 }); }
  }
  function rocket() {
    if (reduced() || !cv) return; const w = cv.width, h = cv.height;
    burst(w * (0.12 + Math.random() * 0.76), h * (0.1 + Math.random() * 0.35), [45, 215, 330, 150, 20][Math.floor(Math.random() * 5)], 46);
    if (cur && cur.snd && cur.snd.boom) cur.snd.boom();
  }
  function frame(t) {
    raf = requestAnimationFrame(frame); if (!g) return; const dt = Math.min(2, (t - last) / 16.7 || 1); last = t;
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, 0, cv.width, cv.height); g.globalCompositeOperation = 'lighter';
    for (let i = fx.length - 1; i >= 0; i--) { const p = fx[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.045 * dt; p.vx *= 0.992; p.life -= p.dec * dt; if (p.life <= 0) { fx.splice(i, 1); continue; } g.fillStyle = `hsla(${p.h},100%,${55 + p.life * 20}%,${Math.max(0, p.life)})`; g.beginPath(); g.arc(p.x, p.y, p.s, 0, 6.283); g.fill(); }
  }
  function fxStart() { cv = $('cerFx'); if (!cv || reduced()) return; g = cv.getContext('2d'); resize(); window.addEventListener('resize', resize); last = performance.now(); if (!raf) raf = requestAnimationFrame(frame); }
  function fxStop() { if (raf) cancelAnimationFrame(raf); raf = 0; fx = []; window.removeEventListener('resize', resize); if (g && cv) g.clearRect(0, 0, cv.width, cv.height); g = null; }

  /* ---------- content ---------- */
  function teamCard(p, i, cer) {
    const c = tint(p, i), row = (cer.standings || []).find(r => r.team.id === p.team.id), el = $(i ? 'cerTeamB' : 'cerTeamA');
    el.style.setProperty('--c1', c[0]); el.style.setProperty('--c2', c[1]);
    el.querySelector('.crest').src = cur.crest(p.team); el.querySelector('.tname').textContent = p.team.name;
    el.querySelector('.tcode').textContent = p.team.teamCode || '';
    el.querySelector('.tplayers').innerHTML = p.members.map(m => `<span>${esc(m.username)}</span>`).join('');
    el.querySelector('.tstat').textContent = row ? `PLAYED ${row.played} · POINTS ${row.points}` : '';
    el.querySelector('.tclub').textContent = p.team.club && p.team.club.name ? p.team.club.name.toUpperCase() : '';
  }
  function table(cer, ids) {
    const rows = (cer.standings || []).map((r, k) => `<li class="${ids.includes(r.team.id) ? 'me' : ''}" data-k="${k}"><b>${r.rank}</b><img alt="" src="${cur.crest(r.team)}"><span class="n">${esc(r.team.name)}</span><i>${r.played}</i><i>${r.gd > 0 ? '+' : ''}${r.gd}</i><strong>${r.points}</strong></li>`).join('');
    $('cerTable').innerHTML = `<li class="h"><b>#</b><span class="n">TEAM</span><i>P</i><i>GD</i><strong>PTS</strong></li>` + rows;
    $('cerTable').querySelectorAll('li:not(.h)').forEach((li, k) => li.style.setProperty('--d', (k * 0.12) + 's'));
  }
  function whenText(iso, serverNow) {
    if (!iso) return 'TIME TO BE ANNOUNCED';
    const t = +new Date(iso); if (!Number.isFinite(t)) return 'TIME TO BE ANNOUNCED';
    const d = new Date(t), today = new Date(), same = d.toDateString() === today.toDateString();
    const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return (same ? 'TODAY' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()) + ' · ' + hm;
  }
  function nextCard(cer) {
    const n = cer.next, box = $('cerNext');
    if (!n) { box.classList.add('none'); $('cerNextMsg').textContent = 'THE NEXT MATCH WILL BE ANNOUNCED SOON'; $('cerNextTeams').innerHTML = ''; return; }
    box.classList.remove('none'); $('cerNextMsg').textContent = whenText(n.scheduledAt);
    $('cerNextTeams').innerHTML = `<div><img alt="" src="${cur.crest(n.teamA)}"><b>${esc(n.teamA.name)}</b></div><em>VS</em><div><img alt="" src="${cur.crest(n.teamB)}"><b>${esc(n.teamB.name)}</b></div>`;
  }
  function setReporters(list) {
    const names = (list || []).filter(Boolean), el = $('cerCommentary'); if (!el) return;
    el.querySelector('.who').textContent = names.length ? names.join(' · ') : 'AUREX TV';
    el.querySelector('.lbl').textContent = names.length ? 'COMMENTARY · گزارشگر' : 'LIVE ON';
    el.classList.toggle('has', names.length > 0);
  }

  function stop() { timers.forEach(clearTimeout); timers = []; const root = $('cer'); if (root) { root.classList.add('hide'); root.classList.remove('lt'); root.querySelectorAll('.sc').forEach(e => e.classList.remove('on')); } fxStop(); cur = null; }

  function play(cer, o) {
    stop(); const root = $('cer'); if (!root || !cer) return false;
    cur = { crest: o.crest, snd: o.snd }; const pre = Math.max(2000, o.preMs || cer.preMs || 18000), el0 = Math.max(0, o.elapsedMs || 0);
    const ids = o.players.map(p => p.team.id);
    const kind = cer.kind || 'league', yr = cer.year || new Date().getFullYear();
    $('cerTitleYear').textContent = kind === 'final' ? `SEASON ${yr} · THE FINAL` : kind === 'semi' ? `SEASON ${yr} · SEMI-FINAL` : `SEASON ${yr} · OPENING CEREMONY`;
    $('cerMatchNo').textContent = kind === 'final' ? 'THE FINAL · THE CUP IS ON THE LINE' : kind === 'semi' ? 'SEMI-FINAL · ONE STEP FROM THE FINAL' : `OPENING MATCH · MATCH ${cer.matchNo || 1} OF ${cer.matchTotal || '–'}`;
    $('cerFpA').src = o.crest(o.players[0].team); $('cerFpB').src = o.crest(o.players[1].team);
    $('cerVsA').src = o.crest(o.players[0].team); $('cerVsB').src = o.crest(o.players[1].team);
    $('cerVsNA').textContent = o.players[0].team.name; $('cerVsNB').textContent = o.players[1].team.name;
    teamCard(o.players[0], 0, cer); teamCard(o.players[1], 1, cer); table(cer, ids); nextCard(cer); setReporters(cer.reporters);
    $('cerTeamsLbl').textContent = `${cer.teamCount || (cer.standings || []).length} TEAMS · ONE CUP`;
    root.classList.remove('hide'); root.classList.remove('lt'); fxStart();
    // timeline in fractions of the ceremony time: title, the pairing, team A, team B, the table, the next match
    const T = kind === 'league' ? [['title', 0], ['vs', 0.16], ['teamA', 0.30], ['teamB', 0.44], ['fair', 0.58], ['table', 0.72], ['next', 0.86]]
      : cer.next ? [['title', 0], ['vs', 0.28], ['fair', 0.56], ['next', 0.78]] : [['title', 0], ['vs', 0.34], ['fair', 0.68]];
    T.forEach(([name, f], k) => {
      const start = pre * f - el0, end = (k + 1 < T.length ? pre * T[k + 1][1] : pre) - el0;
      if (end <= 0) return;                                                        // a late reporter skips the scenes that are already over
      later(Math.max(0, start), () => { scene(name); if (k >= 1) root.classList.add('lt'); if (name === 'title' || name === 'next') { rocket(); later(350, rocket); later(800, rocket); } else rocket(); if (o.snd) { if (name === 'title' && o.snd.fanfare) o.snd.fanfare(); else if (o.snd.whoosh) o.snd.whoosh(); } });
    });
    for (let k = 1; k < 9; k++) later(pre * (0.05 + k * 0.1) - el0, rocket);
    later(pre - el0, () => { stop(); if (o.onDone) o.onDone(); });
    return true;
  }
  window.AurexCeremony = { play, stop, setReporters, active: () => !!cur };
})();
