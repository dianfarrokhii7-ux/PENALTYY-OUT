/* AUREX share cards: draws a 1080x1350 result / champion card on a canvas and hands it to the share sheet (or downloads the PNG).
 * Same-origin logos only, so the canvas is never tainted. No network calls other than the team logos. */
(function () {
  const W = 1080, H = 1350, FONT = '"Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const logoUrl = t => (t && t.hasLogo ? '/api/aurex/teams/' + t.id + '/logo' : '/aurex-logo-sm.png');
  const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  const STAGE = { league: 'LEAGUE MATCH', semi: 'SEMI-FINAL', final: 'FINAL', friendly: 'FRIENDLY' };

  function fit(ctx, text, maxW, size, weight) { let s = size; do { ctx.font = weight + ' ' + s + 'px ' + FONT; s -= 2; } while (ctx.measureText(text).width > maxW && s > 18); return ctx.font; }
  function bg(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0a1330'); g.addColorStop(0.55, '#0d2466'); g.addColorStop(1, '#060b1f'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalAlpha = 0.07; ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(W / 2, 700, 300, 0, Math.PI * 2); ctx.moveTo(0, 700); ctx.lineTo(W, 700); ctx.stroke(); ctx.restore();
    const r = ctx.createRadialGradient(W / 2, 640, 80, W / 2, 640, 700); r.addColorStop(0, 'rgba(70,120,255,.28)'); r.addColorStop(1, 'rgba(70,120,255,0)'); ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e8b84a'; ctx.fillRect(0, 0, W, 10); ctx.fillRect(0, H - 10, W, 10);
  }
  function center(ctx, text, y, color, size, weight, maxW) { ctx.fillStyle = color; ctx.textAlign = 'center'; fit(ctx, text, maxW || W - 120, size, weight || '800'); ctx.fillText(text, W / 2, y); }
  function logo(ctx, img, cx, cy, r, ring) {
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, Math.PI * 2); ctx.fillStyle = ring || 'rgba(255,255,255,.18)'; ctx.fill(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.fillStyle = '#101b45'; ctx.fill(); ctx.clip();
    if (img) { const s = Math.min(img.width, img.height); ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, cx - r, cy - r, r * 2, r * 2); } ctx.restore();
  }
  function footer(ctx, when) {
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.textAlign = 'center'; ctx.font = '600 30px ' + FONT; ctx.fillText(when || new Date().toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }), W / 2, H - 120);
    ctx.fillStyle = '#e8b84a'; ctx.font = '800 34px ' + FONT; ctx.fillText('AUREX CHAMPIONSHIP', W / 2, H - 66);
  }

  /** o: { teamA, teamB, goalsA, goalsB, stage, winnerSide (0|1|null), note, when } — team = { id, name, hasLogo } */
  async function matchCard(o) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d'); bg(ctx);
    const [ia, ib] = await Promise.all([loadImg(logoUrl(o.teamA)), loadImg(logoUrl(o.teamB))]);
    ctx.textAlign = 'center'; ctx.fillStyle = '#e8b84a'; ctx.font = '800 38px ' + FONT; ctx.fillText('AUREX PENALTY CUP', W / 2, 120);
    const tag = STAGE[o.stage] || 'MATCH'; ctx.font = '700 34px ' + FONT; const tw = ctx.measureText(tag).width + 70; ctx.fillStyle = 'rgba(232,184,74,.16)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(W / 2 - tw / 2, 160, tw, 64, 32) : ctx.rect(W / 2 - tw / 2, 160, tw, 64); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(tag, W / 2, 205);
    const gold = 'rgba(232,184,74,.95)';
    logo(ctx, ia, 270, 520, 150, o.winnerSide === 0 ? gold : null); logo(ctx, ib, 810, 520, 150, o.winnerSide === 1 ? gold : null);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; fit(ctx, o.teamA.name, 440, 44, '800'); ctx.fillText(o.teamA.name, 270, 760); fit(ctx, o.teamB.name, 440, 44, '800'); ctx.fillText(o.teamB.name, 810, 760);
    ctx.fillStyle = '#fff'; ctx.font = '900 190px ' + FONT; ctx.fillText(o.goalsA + ' – ' + o.goalsB, W / 2, 1010);
    const verdict = o.winnerSide == null ? 'DRAW' : (o.winnerSide === 0 ? o.teamA.name : o.teamB.name).toUpperCase() + ' WIN';
    center(ctx, verdict, 1100, o.winnerSide == null ? '#cbd3e1' : '#e8b84a', 56, '800', W - 160);
    if (o.note) center(ctx, o.note, 1160, 'rgba(255,255,255,.7)', 34, '600', W - 160);
    footer(ctx, o.when); return c;
  }
  /** o: { team, subtitle, when } */
  async function championCard(o) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d'); bg(ctx);
    const img = await loadImg(logoUrl(o.team));
    ctx.textAlign = 'center'; ctx.fillStyle = '#e8b84a'; ctx.font = '800 40px ' + FONT; ctx.fillText('AUREX PENALTY CUP', W / 2, 120);
    // trophy
    ctx.save(); ctx.translate(W / 2, 390); const g = ctx.createLinearGradient(-120, -150, 120, 150); g.addColorStop(0, '#fff1b8'); g.addColorStop(0.5, '#e8b84a'); g.addColorStop(1, '#a8741a'); ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-110, -150); ctx.lineTo(110, -150); ctx.quadraticCurveTo(110, 40, 0, 70); ctx.quadraticCurveTo(-110, 40, -110, -150); ctx.fill();
    ctx.lineWidth = 22; ctx.strokeStyle = '#e8b84a'; ctx.beginPath(); ctx.arc(-118, -88, 48, Math.PI * 0.55, Math.PI * 1.5); ctx.stroke(); ctx.beginPath(); ctx.arc(118, -88, 48, Math.PI * 1.5, Math.PI * 0.45); ctx.stroke();
    ctx.fillRect(-18, 70, 36, 60); ctx.beginPath(); ctx.moveTo(-80, 150); ctx.lineTo(80, 150); ctx.lineTo(60, 120); ctx.lineTo(-60, 120); ctx.closePath(); ctx.fill(); ctx.restore();
    logo(ctx, img, W / 2, 800, 140, 'rgba(232,184,74,.95)');
    center(ctx, 'CHAMPIONS', 1060, '#e8b84a', 120, '900'); center(ctx, o.team.name, 1150, '#fff', 64, '800', W - 140);
    if (o.subtitle) center(ctx, o.subtitle, 1205, 'rgba(255,255,255,.7)', 32, '600', W - 160);
    footer(ctx, o.when); return c;
  }
  const toBlob = c => new Promise(res => c.toBlob(res, 'image/png'));
  /** Opens the share sheet with the PNG; falls back to a download. Returns 'shared' | 'downloaded' | 'cancelled'. */
  async function share(canvas, fileName, text) {
    const blob = await toBlob(canvas); if (!blob) throw new Error('Could not create the image.');
    const file = new File([blob], fileName + '.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], text: text || '' }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; } }
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = fileName + '.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); return 'downloaded';
  }
  window.AurexShare = { matchCard, championCard, share };
})();
