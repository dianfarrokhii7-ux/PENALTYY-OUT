/* AUREX PENALTY CUP – client: lobby, controls, HUD, VAR overlay, sound. The server decides everything; this file only sends intents. */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const REP = new URLSearchParams(location.search).get('mode') === 'reporter';   // reporter = watch a running match (read-only, own socket)
const SCREENS = ['scrBoot', 'scrHome', 'scrRep', 'scrQueue', 'scrLobby', 'scrEnd'];
const fatal = msg => { const m = $('menu'); m.classList.remove('off'); SCREENS.forEach(x => $(x).classList.toggle('hide', x !== 'scrBoot')); $('bootMsg').textContent = msg; $('bootLink').hidden = false; $('bootLink').textContent = 'Back to AUREX'; };
if (!window.THREE) { fatal('The 3D engine could not be loaded (three.js from cdnjs). Check your connection or ad-blocker and reload.'); return; }
if (!window.AurexPenPhysics || !window.PenGfx) { fatal('A game file failed to load. Reload the page (Ctrl+F5). If it keeps happening, tell the owner.'); return; }
if (!window.io) { fatal('Could not reach the game server connection (socket.io). Reload the page.'); return; }
const P = window.AurexPenPhysics, C = P.C, Gfx = window.PenGfx;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let roomJoinTried = false, clockReady = false, onClock = null;
let sock = null, off = 0, me = -1, uid = -1, actorList = [], room = null, players = [], league = false, stage = 'friendly', phase = 'menu', turn = null, role = 'none', st = { kicks: [0, 0], goals: [0, 0], log: [[], []], first: 0 }, cards = [0, 0];
let aim = { ax: 0, ay: 0.4, curve: 0 }, charging = false, chargeT0 = 0, power = 0, sent = false, ballAll = [], strikeAt = 0, shotClockTimer = null, timers = [], lastKin = '0,0', runInfo = null, started = false, sbReady = false, myTeam = null;
const keys = new Set(), srv = () => Date.now() + off, later = (ms, fn) => { const t = setTimeout(fn, Math.max(0, ms)); timers.push(t); return t; };
const clearLater = () => { timers.forEach(clearTimeout); timers = []; };
const crest = t => (t && t.hasLogo ? `/api/aurex/teams/${t.id}/logo` : 'aurex-logo-sm.png');
const text = (id, v) => { const e = $(id); if (e) e.textContent = v; };
const show = (id, on = true) => { const e = $(id); if (e) e.classList.toggle('hide', !on); };

/* ------------------------------------------------------------------ sound (synthesised, no files) */
const Snd = (() => {
  let ac = null, master = null, crowd = null, ambG = null;
  const ctx = () => { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination); } catch (e) { return null; } } if (ac.state === 'suspended') ac.resume(); return ac; };
  const tone = (f, d, type = 'sine', v = 0.25, f2) => { const a = ctx(); if (!a) return; const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.setValueAtTime(f, a.currentTime); if (f2) o.frequency.exponentialRampToValueAtTime(f2, a.currentTime + d); g.gain.setValueAtTime(v, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + d); o.connect(g); g.connect(master); o.start(); o.stop(a.currentTime + d + 0.02); };
  const noise = (d, v = 0.3, hp = 400, lp = 6000) => { const a = ctx(); if (!a) return; const n = a.sampleRate * d, b = a.createBuffer(1, n, a.sampleRate), x = b.getChannelData(0); for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * (1 - i / n); const s = a.createBufferSource(); s.buffer = b; const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = Math.sqrt(hp * lp); f.Q.value = 0.5; const g = a.createGain(); g.gain.value = v; s.connect(f); f.connect(g); g.connect(master); s.start(); };
  return {
    unlock: ctx,
    mute(on) { Snd._muted = !!on; ctx(); if (master) master.gain.value = on ? 0 : 0.5; },
    whistle() { tone(2900, 0.5, 'sine', 0.22); tone(3100, 0.5, 'sine', 0.16); },
    kick() { tone(150, 0.12, 'sine', 0.55, 60); noise(0.08, 0.35, 300, 3000); },
    net() { noise(0.55, 0.28, 800, 7000); },
    post() { tone(1250, 0.5, 'triangle', 0.3, 900); tone(2480, 0.35, 'sine', 0.12); },
    save() { tone(110, 0.15, 'sine', 0.5, 70); noise(0.1, 0.3, 200, 2500); },
    bounce() { tone(190, 0.07, 'sine', 0.25, 120); },
    beep() { tone(1500, 0.08, 'square', 0.1); },
    fanfare() { [392, 523, 659, 784].forEach((f, i) => later(i * 190, () => { tone(f, 0.6, 'sawtooth', 0.1); tone(f * 2, 0.5, 'triangle', 0.06); })); later(820, () => { [523, 659, 784, 1047].forEach(f => tone(f, 1.5, 'sawtooth', 0.085)); tone(262, 1.6, 'triangle', 0.12); }); },
    boom() { tone(95, 0.55, 'sine', 0.32, 34); noise(0.45, 0.16, 120, 1800); },
    whoosh() { noise(0.7, 0.11, 300, 5200); },
    varIn() { tone(660, 0.15, 'square', 0.12); later(160, () => tone(880, 0.15, 'square', 0.12)); later(320, () => tone(1320, 0.25, 'square', 0.12)); },
    card() { tone(300, 0.3, 'sawtooth', 0.1, 220); },
    roar(big) { const a = ctx(); if (!a) return; if (crowd) { try { crowd.stop(); } catch (e) { } } const d = big ? 3.2 : 1.6, n = a.sampleRate * d, b = a.createBuffer(1, n, a.sampleRate), x = b.getChannelData(0); for (let i = 0; i < n; i++) { const e = Math.sin(Math.PI * i / n); x[i] = (Math.random() * 2 - 1) * e; } const s = a.createBufferSource(); s.buffer = b; const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.4; const g = a.createGain(); g.gain.value = big ? 0.55 : 0.3; s.connect(f); f.connect(g); g.connect(master); s.start(); crowd = s; },
    ambience() { const a = ctx(); if (!a || Snd._amb) return; const n = a.sampleRate * 3, b = a.createBuffer(1, n, a.sampleRate), x = b.getChannelData(0); let l = 0; for (let i = 0; i < n; i++) { l = (l + (Math.random() * 2 - 1) * 0.1) * 0.98; x[i] = l; } const s = a.createBufferSource(); s.buffer = b; s.loop = true; const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; const g = a.createGain(); g.gain.value = 0.35; ambG = g; s.connect(f); f.connect(g); g.connect(master); s.start(); Snd._amb = true; },
    // crowd reactions + sudden-death tension
    gasp() { const a = ctx(); if (!a) return; const d = 1.1, n = Math.floor(a.sampleRate * d), b = a.createBuffer(1, n, a.sampleRate), x = b.getChannelData(0); for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * Math.pow(i / n, 0.6)); const s = a.createBufferSource(); s.buffer = b; const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(950, a.currentTime); f.frequency.exponentialRampToValueAtTime(420, a.currentTime + d); const g = a.createGain(); g.gain.value = 0.55; s.connect(f); f.connect(g); g.connect(master); s.start(); },
    crowd(v, secs) { if (ambG && ac) ambG.gain.setTargetAtTime(v, ac.currentTime, secs || 0.4); },
    heart(on) { if (Snd._hb) { clearInterval(Snd._hb); Snd._hb = null; } if (!on) return; const beat = () => { tone(62, 0.16, 'sine', 0.55, 38); setTimeout(() => tone(56, 0.14, 'sine', 0.4, 34), 190); }; beat(); Snd._hb = setInterval(beat, 860); },
  };
})();

/* ------------------------------------------------------------------ scoreboard (HUD) */
function dotsFor(side) {
  const log = st.log[side] || [], n = st.kicks[side], total = Math.max(5, n + (n >= 5 ? 1 : 0)), out = [];
  const myTurn = turn && turn.shooter === side && (phase === 'aim' || phase === 'runup' || phase === 'flight');
  for (let i = 0; i < total; i++) {
    const e = log[i]; let c = '';
    if (e) c = (e.res === 'goal' ? 'g' : 'm') + (e.var ? ' v' : '') + (e.card ? ' c' : ''); else if (myTurn && i === n) c = 'now';
    out.push(`<i class="${c}"></i>`);
  }
  $('dots' + side).innerHTML = out.join('');
}
function renderBoard() {
  if (!players.length) return;
  players.forEach((p, i) => { text('tn' + i, p.team.name); text('pn' + i, p.members.map(m => m.username + (m.userId === uid ? ' (YOU)' : '')).join(' & ')); const im = $('cr' + i); if (im.getAttribute('src') !== crest(p.team)) im.src = crest(p.team); text('sc' + i, st.goals[i]); dotsFor(i); $('nm' + i).classList.toggle('act', !!turn && turn.shooter === i); });
  const mt = $('modeTag'); mt.textContent = stage === 'final' ? 'FINAL' : stage === 'semi' ? 'SEMI-FINAL' : league ? 'LEAGUE MATCH' : 'FRIENDLY · NOT COUNTED IN THE TABLE'; mt.classList.toggle('league', league);
  let label = 'PENALTIES';
  if (turn) { const k = st.kicks[turn.shooter] + 1; label = k > 5 ? `SUDDEN DEATH · ${k - 5}/5` : `KICK ${k} / 5`; if (turn.retake) label = 'RETAKE'; }
  text('label', label);
}
function tickClock() {
  const c = $('clock'); let s = 0;
  if (turn && phase === 'aim') { const wa = turn.whistleAt, dl = turn.deadline; s = srv() < wa ? Math.ceil(C.RUNUP_MS * 0 + (dl - wa) / 1000) : Math.max(0, Math.ceil((dl - srv()) / 1000)); }
  c.textContent = '00:' + String(clamp(s, 0, 99)).padStart(2, '0'); c.classList.toggle('low', phase === 'aim' && s <= 5 && s > 0);
}

/* ------------------------------------------------------------------ banners / overlays */
let bannerT = 0;
function banner(html, color, ms) { const b = $('banner'); b.innerHTML = html; b.style.color = color || '#fff'; b.classList.add('show'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('show'), ms || 2200); }
let cardT = [];     // own timers: onTurn()'s clearLater() must not be able to leave a card stuck on screen
function hideCard() { cardT.forEach(clearTimeout); cardT = []; const c = $('cardflash'); c.classList.remove('out'); c.classList.add('hide'); }
function flashCard(who, name) {
  cardT.forEach(clearTimeout); cardT = []; const c = $('cardflash'); c.classList.remove('out');
  text('cardText', `YELLOW CARD · ${String(name).toUpperCase()}`); show('cardflash', true); Snd.card(); Gfx.refSignal('card');
  cardT.push(setTimeout(() => c.classList.add('out'), 1900), setTimeout(hideCard, 2300));   // fade out, then gone
}
function roleText() {
  if (!turn) return '';
  const k = turn.retake ? ' <b>(retake)</b>' : '';
  const touch = matchMedia('(pointer:coarse)').matches;
  if (role === 'shooter') return touch ? `<b>YOU SHOOT</b>${k} — touch the goal to aim, <b>hold SHOOT</b> to charge, release to kick. ⟲ ⟳ curve · FEINT early in the run-up.` : `<b>YOU SHOOT</b>${k} — aim with the mouse / finger, hold <b>SPACE</b> to charge, release to shoot. <b>Q / E</b> curve · <b>F</b> feint (early in the run-up only).`;
  if (role === 'keeper') return touch ? `<b>YOU ARE THE GOALKEEPER</b>${k} — move with the left pad (▲ steps off the line, VAR watches!), dive with the right pad.` : `<b>YOU ARE THE GOALKEEPER</b>${k} — <b>A / D</b> move, <b>W</b> steps off the line (VAR watches!), dive: <b>← →</b> low · <b>Q / E</b> high · <b>↑</b> jump.`;
  if (REP) return `📺 <b>${esc(turn.shooterName || '')}</b> shoots · <b>${esc(turn.keeperName || '')}</b> in goal${k}`;
  return `<b>${esc(turn.shooterName || '')}</b> shoots against <b>${esc(turn.keeperName || '')}</b>${k} — your turn comes next, watch the kick.`;
}

/* ------------------------------------------------------------------ VAR overlay */
function drawVar(measures, reasons, prog) {
  const cv = $('varCv'), g = cv.getContext('2d'), W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0a1a44'); gr.addColorStop(1, '#06122c'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(91,149,255,.15)'; g.lineWidth = 1; for (let x = 0; x < W; x += 28) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } for (let y = 0; y < H; y += 28) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  const gy = 44, sc = 70, cx = W / 2;                                   // top-down: goal line at gy, pitch below
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(20, gy); g.lineTo(W - 20, gy); g.stroke();
  g.fillStyle = '#fff'; g.fillRect(cx - 3.66 * 22 - 3, gy - 6, 6, 12); g.fillRect(cx + 3.66 * 22 - 3, gy - 6, 6, 12);
  const kz = measures && measures.keeperKz != null ? measures.keeperKz : 0, lim = C.ENCROACH_LIMIT;
  g.setLineDash([6, 5]); g.strokeStyle = '#f5c84a'; g.beginPath(); g.moveTo(20, gy + lim * sc); g.lineTo(W - 20, gy + lim * sc); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#f5c84a'; g.font = '600 11px system-ui'; g.fillText(`LIMIT ${Math.round(lim * 100)} cm`, W - 110, gy + lim * sc - 4);
  const ky = gy + kz * sc * prog; g.fillStyle = kz > lim ? '#ff5470' : '#41e0a0'; g.beginPath(); g.arc(cx, ky, 9, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#fff'; g.font = '700 12px system-ui'; g.fillText(`GK  ${Math.round(kz * prog * 100)} cm`, cx + 16, ky + 4);
  if (measures && measures.feintProgress != null) {
    const bx = 30, by = 130, bw = W - 60; g.fillStyle = '#41e0a0'; g.fillRect(bx, by, bw * C.FEINT_LEGAL_BELOW, 12); g.fillStyle = '#ffc857'; g.fillRect(bx + bw * C.FEINT_LEGAL_BELOW, by, bw * (C.FEINT_GREY_BELOW - C.FEINT_LEGAL_BELOW), 12); g.fillStyle = '#ff5470'; g.fillRect(bx + bw * C.FEINT_GREY_BELOW, by, bw * (1 - C.FEINT_GREY_BELOW), 12);
    g.fillStyle = '#fff'; g.fillRect(bx + bw * measures.feintProgress * prog - 2, by - 6, 4, 24); g.font = '600 11px system-ui'; g.fillText('KICKER FEINT IN THE RUN-UP', bx, by - 10);
  }
  g.fillStyle = 'rgba(255,255,255,.35)'; g.font = '600 10px system-ui'; g.fillText('TOP VIEW · GOAL LINE', 24, 18);
}
let varAnim = 0;
function varStart(d) {
  show('var', true); show('varVerdict', false); $('varVerdict').className = ''; text('varStatus', 'CHECK IN PROGRESS'); $('varSteps').innerHTML = ''; Snd.varIn(); Gfx.refSignal('var'); Gfx.camera('side');
  let acc = 0; d.steps.forEach(s => { later(acc, () => { const li = document.createElement('li'); li.textContent = s.text; $('varSteps').appendChild(li); Snd.beep(); }); acc += s.ms; });
  const t0 = performance.now(), total = d.ms; cancelAnimationFrame(varAnim);
  const step = () => { const k = clamp((performance.now() - t0) / Math.min(total, 2600), 0, 1); drawVar(d.measures, d.reasons, k); if (performance.now() - t0 < total + 400) varAnim = requestAnimationFrame(step); }; step();
}
function varVerdict(v, good) {
  text('varStatus', 'DECISION'); $('varHead').textContent = v.headline; $('varDetail').textContent = v.detail; const e = $('varVerdict'); e.className = good ? 'good' : 'bad'; show('varVerdict', true); Snd.varIn();
  later(3400, () => show('var', false));
}

/* ------------------------------------------------------------------ socket events */
function setScreen(id) { SCREENS.forEach(s => show(s, s === id)); $('menu').classList.remove('off'); }
function lobbyUI(r) {
  room = r; players = r.players.filter(Boolean);
  text('roomCode', r.code);
  [0, 1].forEach(i => {
    const sd = r.players[i], el = $('lp' + i);
    if (!sd) { el.className = 'pcard off'; el.innerHTML = '<span>Waiting for opponent…</span>'; return; }
    const all = sd.members.length && sd.members.every(m => m.ready);
    el.className = 'pcard' + (all ? ' ready' : '') + (sd.on ? '' : ' off');
    el.innerHTML = `<img alt="" src="${crest(sd.team)}"><b>${esc(sd.team.name)}</b>` + sd.members.map(m => `<span>${m.ready ? '✔' : '•'} ${esc(m.username)}${m.userId === uid ? ' (you)' : ''}</span>`).join('') + (sd.members.length < 2 && i === me ? '<span class="mute">+ your teammate can join with the code</span>' : '');
  });
  const both = r.players[0] && r.players[1], mine = r.players[me] && r.players[me].members.find(m => m.userId === uid);
  $('bReady').disabled = !both || !mine || mine.ready;
  text('lobbyMsg', both ? 'Opponent found. Every player in the room must press Ready.' : 'Share this code: the opponent (another team) or your registered teammate can join.');
  text('modeNote', both ? `${r.players[0].members.length} + ${r.players[1].members.length} players · kicks rotate between teammates` : '');
}
function buildActors() { actorList = []; players.forEach((sd, i) => sd.members.forEach(m => actorList.push({ username: m.username, team: sd.team, side: i, userId: m.userId }))); }
const actorOf = userId => Math.max(0, actorList.findIndex(a => a.userId === userId));
const names = sd => sd.members.map(m => m.username).join(' & ');
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function connect() {
  sock = io('/aurex-pen', { query: REP ? { mode: 'reporter' } : {}, transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 3000 });
  sock.on('connect_error', e => { text('bootMsg', e && /AUTH/.test(e.message) ? 'Please sign in to AUREX first.' : 'Connection problem: ' + (e && e.message)); if (e && /AUTH/.test(e.message)) { $('bootLink').hidden = false; sock.close(); } });
  sock.on('connect', () => { text('conn', ''); syncClock(); });
  sock.on('disconnect', () => { if (phase !== 'end' && phase !== 'menu') text('conn', REP ? 'Connection lost — reconnecting…' : 'Connection lost — reconnecting… (you have 60 s)'); });
  sock.on('hello', d => { if (REP) return repHello(d); myTeam = d.team; uid = d.user.id; setScreen('scrHome'); if (d.team) { text('myTeamName', d.team.name); text('myPlayer', d.user.username); $('myCrest').src = crest(d.team); } else { text('myTeamName', 'No active team'); text('myPlayer', d.user.username); } text('homeErr', d.error || ''); ['bQuick', 'bCreate', 'bJoin'].forEach(b => { $(b).disabled = !!d.error; });
    // coming from the cup page ("Enter match"): go straight into the announced room, once
    const want = new URLSearchParams(location.search).get('room'); if (want && !d.error && !roomJoinTried) { roomJoinTried = true; $('codeIn').value = want.toUpperCase().slice(0, 5); try { history.replaceState(null, '', location.pathname); } catch (_) { } sock.emit('join', { code: want }); } });
  sock.on('err', d => { text('homeErr', d.message || d.code); if (d.code === 'OPENED_ELSEWHERE') { text('conn', d.message); } });
  sock.on('queue', () => setScreen('scrQueue'));
  sock.on('joined', d => { me = d.you; if (d.uid != null) uid = d.uid; setScreen('scrLobby'); lobbyUI(d.room); });
  sock.on('lobby', d => { if (phase === 'menu') lobbyUI(d.room); });
  sock.on('room', d => { room = d.room; if (!started) return; const off2 = d.room.players.findIndex(p => p && !p.on); text('conn', off2 >= 0 ? (REP ? d.room.players[off2].team.name + ' lost the connection — waiting up to 60 s for them to return…' : off2 === me ? '' : 'Opponent disconnected — waiting up to 60 s for them to return…') : ''); });
  if (REP) { sock.on('spec:list', repList); sock.on('spec:start', repStart); sock.on('spec:error', d => text('repErr', d.message || d.code)); sock.on('spec:end', repGone); }
  sock.on('match:start', onMatchStart); sock.on('ceremony:reporters', d => { if (window.AurexCeremony) AurexCeremony.setReporters(d.reporters); });
  sock.on('sync', onSync);
  sock.on('turn', onTurn);
  sock.on('kp', d => Gfx.keeperTo(d.x, d.kz));
  sock.on('runup', onRunup);
  sock.on('feint', d => { Gfx.feint(d.progress, d.strikeAt); Gfx.setStrike(d.strikeAt); strikeAt = d.strikeAt; runInfo.strikeAt = d.strikeAt; runInfo.feintAt = d.progress; });
  sock.on('kick', onKick);
  sock.on('ball', onBall);
  sock.on('dive', d => { Gfx.setDive(d.dir, d.hi, d.tdMs); if (d.x != null) Gfx.keeperTo(d.x, d.kz); });
  sock.on('var:start', d => { phase = 'var'; varStart(d); });
  sock.on('result', onResult);
  sock.on('end', onEnd);
}
function onRunup(d) { phase = 'runup'; strikeAt = d.strikeAt; Gfx.startRun(d.runAt, d.strikeAt); Gfx.setStrike(d.strikeAt); runInfo = d; Gfx.setAim(aim.ax, aim.ay, aim.curve, false, 0); show('power', false); if (role === 'shooter') show('runbar', true); text('hint', role === 'shooter' ? 'Feint now = legal (green) · late = illegal (red)' : REP ? '' : 'Read the run-up… dive when you decide'); }
function syncClock() {
  const samples = []; let n = 0;
  const one = () => { const t0 = Date.now(); sock.emit('ping:t', sv => { const t1 = Date.now(), rtt = t1 - t0; samples.push({ rtt, off: sv - (t0 + rtt / 2) }); if (++n < 6) setTimeout(one, 80); else { samples.sort((a, b) => a.rtt - b.rtt); off = samples[0].off; clockReady = true; if (onClock) { const f = onClock; onClock = null; f(); } } }); };
  one();
}

function applyScore(d) { if (d.kicks) { st = { kicks: d.kicks, goals: d.goals, log: d.log, first: d.first != null ? d.first : st.first }; } if (d.cards) cards = d.cards; renderBoard(); }

async function shareResult() {
  const d = lastEnd, b = $('bShare'); if (!d || !window.AurexShare) return; b.disabled = true; $('shareMsg').textContent = 'Preparing the card…';
  try {
    const note = $('endWhy').textContent.replace(/\s*\(Warning:.*$/, '');
    const card = await AurexShare.matchCard({ teamA: players[0].team, teamB: players[1].team, goalsA: d.table[0], goalsB: d.table[1], stage: d.stage || 'friendly', winnerSide: d.winner == null ? null : d.winner, note });
    const r = await AurexShare.share(card, 'aurex-' + (players[0].team.name + '-vs-' + players[1].team.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'), `${players[0].team.name} ${d.table[0]}–${d.table[1]} ${players[1].team.name} · AUREX Penalty Cup`);
    $('shareMsg').textContent = r === 'downloaded' ? 'Card saved as an image.' : r === 'shared' ? 'Shared!' : '';
  } catch (e) { $('shareMsg').textContent = 'Could not create the card.'; } finally { b.disabled = false; }
}
/** The normal walk-out intro (names, title, coin toss). With the opening ceremony it starts `delay` ms later, after the ceremony part. */
function scheduleIntro(base, delay) {
  const it = $('intro'), nIn = Math.min(2600, base * 0.28), tOut = base * 0.66;
  later(delay + nIn, () => it.classList.add('names-in')); later(delay + tOut, () => { it.classList.add('names-out'); it.classList.add('title-in'); show('hud', false); Snd.roar(false); });
  later(delay + base - 200, () => { $('fade').classList.add('on'); }); later(delay + base + 150, () => { show('hud', true); show('intro', false); $('fade').classList.remove('on'); Gfx.stopIntro(); });
}
/** Opening ceremony (first league match): overlay scenes + trophy flyover. `elapsed` > 0 = a reporter who joined while it was already running. */
function runCeremony(cer, pre, base, elapsed) {
  if (!window.AurexCeremony || !AurexCeremony.play(cer, { players, preMs: pre, elapsedMs: elapsed, crest, snd: Snd })) return false;
  show('hud', false); later(pre - elapsed, () => show('hud', true));
  $('cerSkip').onclick = () => {                                  // SKIP: jump to the walk-out; the match clock on the server does not change
    AurexCeremony.stop(); clearLater(); Gfx.skipPre(); show('hud', true); scheduleIntro(base, 0);
    const it = $('intro'); it.className = ''; show('intro', true);
  };
  return true;
}
function onMatchStart(d) {
  started = true; league = d.league; stage = d.stage || (d.league ? 'league' : 'friendly'); players = d.players; phase = 'intro';
  st = { kicks: [0, 0], goals: [0, 0], log: [[], []], first: d.first }; $('menu').classList.add('off'); show('hud', true); show('pad', false); Snd.unlock(); Snd.ambience();
  buildActors();
  try { initGfx(); Gfx.setActors(actorList); } catch (e) { $('menu').classList.remove('off'); fatal('Graphics could not start: ' + e.message + '. Your browser/device needs WebGL — try Chrome or Safari, and turn on hardware acceleration.'); sock.emit('leave'); return; }
  const cer = d.ceremony && d.ceremony.opening ? d.ceremony : null, pre = cer ? (cer.preMs || 0) : 0, base = d.introMs - pre;
  Gfx.setClock(srv); renderBoard(); text('role', ''); text('hint', ''); show('runbar', false); show('power', false); show('curveui', false);
  Gfx.startIntro(srv(), d.introMs, pre); Gfx.crowdCheer(true); Snd.roar(true);
  players.forEach((p, i) => { text('itn' + i, p.team.name); text('ipn' + i, names(p)); $('icr' + i).src = crest(p.team); });
  const it = $('intro'); it.className = ''; show('intro', true); const first = players[d.first];
  text('coin', `COIN TOSS · ${first.team.name.toUpperCase()} KICKS FIRST`);
  scheduleIntro(base, pre); if (cer) runCeremony(cer, pre, base, 0);
}
function initGfx() {
  if (sbReady) return; sbReady = true;
  try { Gfx.init($('gl')); } catch (e) { console.error(e); sbReady = false; throw e; }
  requestAnimationFrame(loop);
}
function safeLoop() { try { Gfx.render(); } catch (e) { if (!safeLoop.warned) { safeLoop.warned = true; console.error('render error', e); text('conn', 'Graphics error: ' + e.message); } } }
function loop() { safeLoop(); tickClock(); inputFrame(); if (REP) repTick(); requestAnimationFrame(loop); }

function onSync(d) {
  started = true; me = d.you; if (d.uid != null) uid = d.uid; league = d.league; stage = d.stage || (d.league ? 'league' : 'friendly'); players = d.room.players.filter(Boolean); st = { kicks: d.kicks, goals: d.goals, log: d.log, first: d.first }; cards = d.cards || [0, 0];
  $('menu').classList.add('off'); show('hud', true); buildActors(); initGfx(); Gfx.setActors(actorList); Gfx.setClock(srv); renderBoard(); text('conn', '');
  if (d.turn && d.phase === 'aim') onTurn({ ...d.turn, ...d, k: d.turn.k }); else { phase = d.phase; Gfx.camera('result', true); text('hint', 'Reconnected — next kick coming up…'); }
}

/** Sudden death: both sides have taken their 5 kicks. The second kick of a round decides it (or sends it on). Returns null before sudden death. */
function pressureFor(d) {
  if (!(st.kicks[0] >= 5 && st.kicks[1] >= 5)) return null;
  const s = d.shooter, o = 1 - s, second = st.kicks[o] > st.kicks[s], theirs = second && st.log[o] && st.log[o][st.kicks[s]], oScored = !!(theirs && theirs.res === 'goal');
  let tag = 'SUDDEN DEATH';
  if (second) { if (role === 'shooter') tag = oScored ? 'SCORE OR LOSE' : 'SCORE TO WIN'; else if (role === 'keeper') tag = oScored ? 'SAVE TO WIN' : 'SAVE OR LOSE'; else tag = 'SUDDEN DEATH · DECIDING KICK'; }
  return { hot: second, tag };
}
function setPressure(p) {
  const hud = $('hud'); hud.classList.toggle('sd', !!p); hud.classList.toggle('hot', !!(p && p.hot)); show('sdTag', !!p); if (p) text('sdTag', p.tag);
  Snd.heart(!!(p && p.hot)); Snd.crowd(p ? (p.hot ? 0.1 : 0.22) : 0.35, 0.6);
}
function onTurn(d) {
  if (window.AurexCeremony) AurexCeremony.stop();
  clearLater(); hideCard(); show('hud', true); show('intro', false); $('fade').classList.remove('on'); Gfx.stopIntro(); turn = d; phase = 'aim'; started = true; role = d.shooterUser === uid ? 'shooter' : d.keeperUser === uid ? 'keeper' : 'spectator'; sent = false; charging = false; power = 0; aim = { ax: 0, ay: 0.4, curve: 0 }; ballAll = []; runInfo = null; lastKin = '0,0';
  applyScore(d); show('var', false); show('callbox', false); $('banner').classList.remove('show'); show('runbar', false); setPressure(pressureFor(d));
  Gfx.clearTurn(); Gfx.setRole(role, actorOf(d.shooterUser), actorOf(d.keeperUser)); Gfx.keeperSnap(0, 0); Gfx.camera(role === 'keeper' ? 'keeper' : 'shooter', true);
  Gfx.setAim(aim.ax, aim.ay, 0, role === 'shooter', 0); Gfx.crowdCheer(false);
  $('role').innerHTML = roleText(); show('power', role === 'shooter'); show('curveui', role === 'shooter'); $('power').firstElementChild.style.width = '0%'; updateCurveUI();
  show('padShoot', role === 'shooter'); show('padKeep', role === 'keeper'); show('pad', role !== 'spectator');
  text('hint', role === 'shooter' ? 'Wait for the whistle…' : role === 'keeper' ? 'Position yourself on the line — wait for the whistle' : REP ? '' : 'Your teammate or opponent is on — watch and get ready');
  if (d.retake) banner('RETAKE', '#ffd23f', 1400);
  if (d.whistleAt > srv() - 300) later(d.whistleAt - srv(), () => { if (phase === 'aim') { Snd.whistle(); Gfx.refSignal('whistle'); text('hint', role === 'shooter' ? 'WHISTLE — you can shoot!' : REP ? '' : 'WHISTLE — the kicker is about to shoot'); } });
}
function onKick(d) {
  Snd.heart(false); phase = 'flight'; strikeAt = d.strikeAt; Gfx.setStrike(d.strikeAt); Gfx.camera(role === 'keeper' ? 'flightK' : 'flightS'); show('runbar', false); show('power', false); text('hint', '');
  Gfx.keeperTo(d.keeper.x, d.keeper.kz); if (d.strikeAt > srv()) later(d.strikeAt - srv(), () => { Snd.kick(); }); Gfx.shake(0.02);
}
function onBall(d) {
  if (d.replace) { ballAll.length = Math.min(ballAll.length, d.from); Gfx.pushBall(d.from, [], true); }
  if (d.pts && d.pts.length) { Gfx.pushBall(d.from, d.pts, false); d.pts.forEach((p, i) => { ballAll[d.from + i] = p; }); }
  (d.ev || []).forEach(e => later(strikeAt + e.t * 1000 - srv() - 100 + 100, () => {
    if (e.type === 'post' || e.type === 'bar') { Snd.post(); Gfx.shake(0.06); } else if (e.type === 'net') { Snd.net(); Gfx.netImpact(e.x, e.y, 20); Gfx.shake(0.04); } else if (e.type === 'parry' || e.type === 'catch') { Snd.save(); Gfx.shake(0.05); } else if (e.type === 'bounce') Snd.bounce();
  }));
}
function onResult(d) {
  phase = 'result'; applyScore(d); show('power', false); show('runbar', false); Gfx.setAim(0, 0, 0, false, 0); Gfx.camera('result'); show('padShoot', false); show('padKeep', false);
  const sName = d.shooterName || players[d.shooter].team.name, kName = d.keeperName || players[d.keeper].team.name, final = d.final, sa = actorOf(d.shooterUser), ka = actorOf(d.keeperUser);
  const verdict = d.var ? d.var.verdict : null; if (verdict) varVerdict(verdict, final === 'goal' || final === 'save' ? true : false);
  if (d.call) { text('callHead', d.call.headline); text('callDetail', d.call.detail); show('callbox', true); later(3600, () => show('callbox', false)); }
  (d.cards || []).forEach((c, i) => later(500 + i * 1700, () => flashCard(c.who, c.who === 'shooter' ? sName : kName)));
  const sub = verdict ? `<small>VAR · ${esc(verdict.headline)}</small>` : '';
  if (final === 'retake') { banner('RETAKE' + sub, '#ffd23f', 2400); Gfx.react('retake', sa, ka); return; }
  if (final === 'goal') { banner('GOAL!' + sub, '#41e0a0', 2600); Gfx.react('goal', sa, ka); Gfx.crowdCheer(true); Snd.roar(true); later(900, () => { const rs = ballAll.filter(Boolean); if (rs.length > 8) { banner('REPLAY', '#cbd3e1', 2600); Gfx.startReplay(rs, REP ? repSpeed() : 0.3, 'goalcam'); if (REP) repReplayUI(); } }); }
  else if (final === 'save') { banner('SAVED!' + sub, '#5b95ff', 2400); Gfx.react('save', sa, ka); Snd.roar(false); }
  else if (final === 'post') { banner('OFF THE POST!' + sub, '#ffd23f', 2400); Gfx.react('miss', sa, ka); Snd.roar(false); }
  else { banner((d.timeout ? 'TOO SLOW!' : 'MISSED!') + sub, '#ff6b86', 2400); Gfx.react('miss', sa, ka); }
  text('hint', '');
  Snd.heart(false); Snd.crowd(0.35, 0.8); if (final === 'post' || (final === 'save' && $('hud').classList.contains('sd'))) later(350, () => Snd.gasp());
  later(2300, () => { if (phase === 'result') $('hud').classList.remove('hot'); });
}
let lastEnd = null;
function onEnd(d) {
  lastEnd = d; $('shareMsg').textContent = ''; Snd.heart(false); Snd.crowd(0.35, 0.8); $('hud').classList.remove('sd', 'hot'); show('sdTag', false);
  phase = 'end'; clearLater(); hideCard(); show('var', false); show('callbox', false); show('pad', false); text('role', ''); text('hint', ''); text('conn', ''); applyScore(d); Gfx.setAim(0, 0, 0, false, 0); Gfx.camera('end');
  const win = d.winner === me, draw = d.winner == null; text('endTitle', draw ? 'DRAW' : REP ? players[d.winner].team.name.toUpperCase() + ' WIN' : win ? 'VICTORY' : 'DEFEAT'); text('endScore', `${d.table[0]} – ${d.table[1]}`);
  text('endTeams', `${players[0].team.name}  vs  ${players[1].team.name}`);
  const mt = $('endMode'); mt.textContent = d.stage === 'final' ? 'FINAL — official result' : d.stage === 'semi' ? 'SEMI-FINAL — official result' : d.league ? 'LEAGUE MATCH — recorded in the AUREX table' : 'FRIENDLY — not counted in the table'; mt.className = 'tagline' + (d.league ? ' league' : '');
  const why = { normal: 'Won after the regular five kicks.', sudden_death: 'Won in sudden death.', cap_draw: 'Level after 10 kicks each — the match is a draw.' + (d.stage === 'semi' || d.stage === 'final' ? ' The team that finished higher in the league table goes through.' : ''), forfeit: REP ? 'A team left the match — 3–0 awarded to the other team.' : d.winner === me ? 'Your opponent left the match — 3–0 awarded.' : 'You left the match — 3–0 awarded to your opponent.' }[d.reason] || '';
  text('endWhy', why + (d.saved ? '' : '  (Warning: the result could not be saved — tell the owner.)'));
  if (!draw) { Gfx.react('goal', Math.max(0, actorList.findIndex(a => a.side === d.winner)), Math.max(0, actorList.findIndex(a => a.side !== d.winner))); Snd.roar(true); Gfx.crowdCheer(true); }
  if (REP) { show('repbar', false); Gfx.setReporterCam('auto'); }
  later(2600, () => { setScreen('scrEnd'); });
}

/* ------------------------------------------------------------------ input */
function updateCurveUI() { const f = $('curveFill'); f.style.left = aim.curve < 0 ? (50 + aim.curve * 50) + '%' : '50%'; f.style.width = Math.abs(aim.curve) * 50 + '%'; }
function canShoot() { return role === 'shooter' && phase === 'aim' && !sent && turn && srv() >= turn.whistleAt; }
function doShoot() {
  if (!canShoot()) { charging = false; return; }
  sent = true; charging = false; sock.emit('shoot', { ax: aim.ax, ay: aim.ay, pw: clamp(power, 0.2, 1), curve: aim.curve }); Snd.unlock();
}
function doDive(screenDir, hi) {
  if (role !== 'keeper' || !(phase === 'runup' || phase === 'flight')) return;
  const dir = -screenDir;                                   // the keeper camera looks along +z: screen-right is world −x
  if (dir === 0 && !hi) return; sock.emit('dive', { dir, hi }); Gfx.setDive(dir, hi, srv());
}
function onKey(e, down) {
  if (e.repeat && down) { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); return; }
  const c = e.code; if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(c)) e.preventDefault();
  if (REP) { if (down) repKey(c); return; }
  if (down) keys.add(c); else keys.delete(c);
  if (role === 'shooter') {
    if (c === 'Space' && down && canShoot()) { charging = true; chargeT0 = performance.now(); Snd.unlock(); }
    if (c === 'Space' && !down && charging) doShoot();
    if (down && (c === 'KeyQ' || c === 'CurveL')) { aim.curve = clamp(Math.round((aim.curve - 0.25) * 4) / 4, -1, 1); updateCurveUI(); }
    if (down && (c === 'KeyE' || c === 'CurveR')) { aim.curve = clamp(Math.round((aim.curve + 0.25) * 4) / 4, -1, 1); updateCurveUI(); }
    if (down && (c === 'KeyF' || c === 'Feint') && phase === 'runup') sock.emit('feint');
  } else if (role === 'keeper' && down) {
    if (c === 'ArrowLeft' || c === 'DiveL') doDive(-1, false); else if (c === 'ArrowRight' || c === 'DiveR') doDive(1, false);
    else if (c === 'ArrowUp' || c === 'Space' || c === 'DiveUp') doDive(0, true); else if (c === 'KeyQ' || c === 'DiveHL') doDive(-1, true); else if (c === 'KeyE' || c === 'DiveHR') doDive(1, true);
  }
}
function inputFrame() {
  if (role === 'shooter' && phase === 'aim' && !sent) {
    let dx = 0, dy = 0; if (keys.has('ArrowLeft')) dx -= 1; if (keys.has('ArrowRight')) dx += 1; if (keys.has('ArrowUp')) dy += 1; if (keys.has('ArrowDown')) dy -= 1;
    if (dx || dy) { aim.ax = clamp(aim.ax + dx * 0.02, -1.4, 1.4); aim.ay = clamp(aim.ay + dy * 0.015, 0, 1.45); }
    if (charging) { power = clamp(0.2 + (performance.now() - chargeT0) / 1300 * 0.8, 0.2, 1); if (power >= 1 && performance.now() - chargeT0 > 1700) doShoot(); } else power = Math.max(0, power - 0.05);
    $('power').firstElementChild.style.width = Math.round(power * 100) + '%';
    Gfx.setAim(aim.ax, aim.ay, aim.curve, true, charging ? (power - 0.2) / 0.8 : 0);
  }
  if (role === 'keeper' && (phase === 'aim' || phase === 'runup')) {
    const left = keys.has('KeyA') ? -1 : 0, right = keys.has('KeyD') ? 1 : 0, mx = -(left + right), mz = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);   // screen-right = world −x
    const k = mx + ',' + mz; if (k !== lastKin) { lastKin = k; sock.emit('kin', { mx, mz }); }
  }
  if (phase === 'runup' && runInfo && role === 'shooter') { const p = clamp((srv() - runInfo.runAt) / (runInfo.strikeAt - runInfo.runAt - (runInfo.feintAt != null ? 0 : 0)), 0, 1); $('runbar').firstElementChild.style.width = Math.round(p * 100) + '%'; }
  // gamepad-free: touch buttons use the same key codes
}
function bindUI() {
  addEventListener('keydown', e => { if (e.target && e.target.tagName === 'INPUT') return; onKey(e, true); }); addEventListener('keyup', e => { if (e.target && e.target.tagName === 'INPUT') return; onKey(e, false); });
  const cv = $('gl');
  const aimFrom = (x, y) => { if (role !== 'shooter' || phase !== 'aim' || sent) return; const r = Gfx.reticleRay(x, y); if (r) { aim.ax = r.ax; aim.ay = r.ay; } };
  cv.addEventListener('pointermove', e => aimFrom(e.clientX, e.clientY));
  cv.addEventListener('pointerdown', e => { aimFrom(e.clientX, e.clientY); if (e.pointerType === 'mouse' && role === 'shooter' && canShoot()) { charging = true; chargeT0 = performance.now(); Snd.unlock(); } });
  addEventListener('pointerup', e => { if (e.pointerType === 'mouse' && charging) doShoot(); });
  document.querySelectorAll('#pad button').forEach(b => {
    const k = b.dataset.k; b.addEventListener('pointerdown', e => { e.preventDefault(); b.classList.add('p'); b.setPointerCapture(e.pointerId); onKey({ code: k, preventDefault() { } }, true); });
    const up = e => { b.classList.remove('p'); onKey({ code: k, preventDefault() { } }, false); }; b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  });
  $('bQuick').onclick = () => { Snd.unlock(); text('homeErr', ''); sock.emit('quick'); };
  $('bCreate').onclick = () => { Snd.unlock(); text('homeErr', ''); sock.emit('create'); };
  $('bJoin').onclick = () => { Snd.unlock(); sock.emit('join', { code: $('codeIn').value }); };
  $('codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('bJoin').click(); });
  $('bCancel').onclick = () => { sock.emit('leave'); setScreen('scrHome'); };
  $('bLeave').onclick = () => { sock.emit('leave'); setScreen('scrHome'); me = -1; };
  $('bReady').onclick = () => { Snd.unlock(); sock.emit('ready'); $('bReady').disabled = true; };
  addEventListener('contextmenu', e => e.preventDefault());
  $('bShare').onclick = shareResult;
  bindFullscreen();
}
function bindFullscreen() {
  const b = $('fsBtn'), root = document.documentElement;
  const req = root.requestFullscreen || root.webkitRequestFullscreen, exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (!b || !req || !exit) return;                       // e.g. iPhone Safari: no element fullscreen, keep the button hidden
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const sync = () => { b.classList.toggle('on', isFs()); const t = isFs() ? 'Exit fullscreen' : 'Fullscreen'; b.title = t; b.setAttribute('aria-label', t); };
  b.hidden = false;
  b.addEventListener('pointerdown', e => e.stopPropagation());   // never leaks into aiming / shooting
  b.addEventListener('click', e => {
    e.preventDefault(); b.blur();                         // blur: SPACE (shoot) must not re-trigger the button
    try { const r = isFs() ? exit.call(document) : req.call(root); if (r && r.catch) r.catch(() => { }); } catch (_) { }
  });
  document.addEventListener('fullscreenchange', sync); document.addEventListener('webkitfullscreenchange', sync); sync();
}
/* ------------------------------------------------------------------ REPORTER (read-only spectator, own socket: ?mode=reporter) */
// Angles: key 1-9 or the buttons, C / → next, ← previous. 'auto' = the normal director that follows the action.
const ANGLES = [['auto', 'AUTO'], ['broadcast', 'BROADCAST'], ['shooter', 'KICKER'], ['keeper', 'KEEPER'], ['net', 'NET CAM'], ['goalcam', 'GOAL CAM'], ['side', 'SIDE'], ['top', 'TOP VIEW'], ['ball', 'BALL CAM']];
let repAngle = 0, repSlowOn = true, repCode = null, repPoll = null, repAutoTried = false, repMuted = false, repWasReplaying = false;
const repSpeed = () => (repSlowOn ? 0.3 : 1);
function repAngleSet(i) {
  repAngle = (i + ANGLES.length) % ANGLES.length; Gfx.setReporterCam(ANGLES[repAngle][0]);
  document.querySelectorAll('#repAngles button').forEach((b, j) => { b.classList.toggle('on', j === repAngle); b.setAttribute('aria-pressed', String(j === repAngle)); });
}
function repHello(d) {
  uid = d.user.id; text('repErr', '');
  if (repCode) { sock.emit('spec:watch', { code: repCode }); return; }          // reconnected while watching: take the seat in the stand again
  setScreen('scrRep');
  clearInterval(repPoll); repPoll = setInterval(() => { if (!$('scrRep').classList.contains('hide') && !$('menu').classList.contains('off')) sock.emit('spec:list'); }, 4000);
  const go = () => { sock.emit('spec:list'); const want = new URLSearchParams(location.search).get('code'); if (want && !repAutoTried) { repAutoTried = true; sock.emit('spec:watch', { code: want }); } };
  if (clockReady) go(); else onClock = go;                                       // the match clock must be synchronised before the ball is drawn
}
function repList(d) {
  const box = $('repList'), list = (d && d.list) || [];
  if (!list.length) { box.innerHTML = '<p class="sub">No match is running right now. This list refreshes by itself — stay on this page and the next match will appear.</p>'; return; }
  box.innerHTML = list.map(m => {
    const a = m.sides[0], b = m.sides[1], tag = m.stage === 'final' ? 'FINAL' : m.stage === 'semi' ? 'SEMI-FINAL' : m.league ? 'LEAGUE' : 'FRIENDLY';
    return `<button type="button" class="repm" data-c="${esc(m.code)}"><span class="rt"><img alt="" src="${crest(a.team)}"><b>${esc(a.team.name)}</b></span><span class="rs">${m.goals[0]} – ${m.goals[1]}<small>${tag}</small></span><span class="rt r"><b>${esc(b.team.name)}</b><img alt="" src="${crest(b.team)}"></span><small class="rw">${esc(a.players.join(' & '))} vs ${esc(b.players.join(' & '))} · kicks ${m.kicks[0]}/${m.kicks[1]} · 👁 ${m.watchers}</small></button>`;
  }).join('');
  box.querySelectorAll('button').forEach(b => { b.onclick = () => { Snd.unlock(); text('repErr', ''); sock.emit('spec:watch', { code: b.dataset.c }); }; });
}
function repStart(d) {
  clearLater(); hideCard(); repCode = d.code; started = true; league = d.league; stage = d.stage || (d.league ? 'league' : 'friendly'); players = d.players.filter(Boolean); role = 'spectator'; me = -1; turn = null; ballAll = []; lastEnd = null;
  st = { kicks: d.kicks, goals: d.goals, log: d.log, first: d.first }; cards = d.cards || [0, 0]; phase = d.phase === 'intro' ? 'intro' : 'result';
  $('menu').classList.add('off'); show('hud', true); show('pad', false); show('repbar', true); show('var', false); show('callbox', false); show('intro', false); $('fade').classList.remove('on'); show('runbar', false); show('power', false); show('curveui', false);
  text('repWatch', `· ${d.watchers} watching`); text('role', ''); text('hint', ''); text('conn', ''); Snd.unlock(); Snd.ambience(); buildActors();
  try { initGfx(); Gfx.setActors(actorList); } catch (e) { $('menu').classList.remove('off'); fatal('Graphics could not start: ' + e.message + '. Your browser/device needs WebGL — try Chrome or Safari, and turn on hardware acceleration.'); sock.emit('spec:leave'); return; }
  Gfx.setClock(srv); Gfx.stopIntro(); Gfx.clearTurn(); Gfx.crowdCheer(false); repAngleSet(repAngle); renderBoard();
  if (d.phase === 'intro' && d.ceremony && d.ceremony.opening && d.introMs != null) {          // joined during the opening ceremony: watch the rest of it
    const cer = d.ceremony, pre = cer.preMs || 0, base = d.introMs - pre, elapsed = d.introMs - (d.introLeftMs || 0);
    if (elapsed < pre) {
      Gfx.startIntro(srv() - elapsed, d.introMs, pre); Gfx.crowdCheer(true); players.forEach((p, i) => { text('itn' + i, p.team.name); text('ipn' + i, names(p)); $('icr' + i).src = crest(p.team); });
      text('coin', `COIN TOSS · ${players[d.first].team.name.toUpperCase()} KICKS FIRST`); const it = $('intro'); it.className = ''; show('intro', true);
      scheduleIntro(base, pre - elapsed); runCeremony(cer, pre, base, elapsed); return;
    }
  }
  const t = d.turn, sc = { kicks: d.kicks, goals: d.goals, log: d.log, first: d.first, cards: d.cards };
  if (t && ['aim', 'runup', 'flight', 'reveal'].includes(d.phase)) {                       // joined in the middle of a kick: rebuild it from the same facts the players got
    onTurn({ ...t, ...sc });
    if (t.keeperPos) Gfx.keeperSnap(t.keeperPos.x, t.keeperPos.kz);
    if (d.phase !== 'aim' && t.runAt) { onRunup({ runAt: t.runAt, strikeAt: t.strikeAt, runMs: t.runMs }); if (t.feint) Gfx.feint(t.feint.progress, t.strikeAt); }
    if (t.dive) Gfx.setDive(t.dive.dir, t.dive.hi, t.dive.tdMs);
    if (d.kick) { onKick(d.kick); onBall({ from: 0, pts: d.ball || [], ev: [] }); phase = d.phase === 'reveal' ? 'reveal' : 'flight'; }
  } else {
    if (t) { turn = t; applyScore(sc); }
    Gfx.camera('result', true); text('hint', phase === 'intro' ? 'The match is about to start…' : 'Next kick coming up…');
  }
}
function repBack() {
  if (window.AurexCeremony) AurexCeremony.stop();
  sock.emit('spec:leave'); repCode = null; clearLater(); hideCard(); Gfx.stopReplay(); Gfx.setReporterCam('auto'); Snd.heart(false);
  started = false; turn = null; phase = 'menu'; role = 'none'; players = []; ballAll = [];
  show('hud', false); show('repbar', false); show('var', false); show('callbox', false); show('pad', false); show('sdTag', false); $('hud').classList.remove('sd', 'hot'); $('banner').classList.remove('show'); text('conn', '');
  setScreen('scrRep'); sock.emit('spec:list');
}
function repGone() { if (phase === 'end') return; repBack(); text('repErr', 'That match was cancelled.'); }
function repReplay() {
  if (!['result', 'waiting', 'end'].includes(phase)) { text('hint', 'Replay is available between kicks.'); return; }
  const rs = ballAll.filter(Boolean); if (rs.length < 9) { text('hint', 'No kick to replay yet.'); return; }
  Gfx.startReplay(rs, repSpeed(), 'goalcam'); repTick();
}
const repStopReplay = () => { Gfx.stopReplay(); repTick(); };
function repSlowToggle() { repSlowOn = !repSlowOn; text('rSlow', 'SLOW-MO: ' + (repSlowOn ? 'ON' : 'OFF') + ' (M)'); }
function repMuteToggle() { repMuted = !repMuted; Snd.mute(repMuted); text('rMute', repMuted ? '🔇' : '🔊'); }
function repReplayUI() { repTick(); }
function repTick() { const on = Gfx.isReplaying(); if (on !== repWasReplaying) { repWasReplaying = on; show('rStop', on); } }
function repKey(c) {
  if (!repCode) return;
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(c); if (m) return repAngleSet(+m[1] - 1);
  if (c === 'KeyC' || c === 'ArrowRight') repAngleSet(repAngle + 1); else if (c === 'ArrowLeft') repAngleSet(repAngle - 1);
  else if (c === 'KeyR') repReplay(); else if (c === 'KeyM') repSlowToggle(); else if (c === 'Escape') repStopReplay(); else if (c === 'KeyS') repMuteToggle();
}
function repInit() {
  $('repAngles').innerHTML = ANGLES.map((a, i) => `<button type="button" data-i="${i}" aria-pressed="false"><i>${i + 1}</i>${a[1]}</button>`).join('');
  $('repAngles').querySelectorAll('button').forEach(b => { b.onclick = () => { b.blur(); repAngleSet(+b.dataset.i); }; });
  $('rRep').onclick = () => { $('rRep').blur(); repReplay(); }; $('rSlow').onclick = () => { $('rSlow').blur(); repSlowToggle(); }; $('rStop').onclick = repStopReplay; $('rMute').onclick = () => { $('rMute').blur(); repMuteToggle(); }; $('rExit').onclick = repBack; $('bRepBack').onclick = repBack;
  document.body.classList.add('rep'); show('endBtns', false); show('bRepBack', true); repAngleSet(0);
}

bindUI(); if (REP) repInit(); connect();
window.__pen = { get state() { return { phase, role, me, st, turn, league }; } };    // handy for debugging
})();
