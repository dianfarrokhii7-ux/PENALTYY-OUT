/* AUREX PENALTY CUP – client: lobby, controls, HUD, VAR overlay, sound. The server decides everything; this file only sends intents. */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const fatal = msg => { const m = $('menu'); m.classList.remove('off'); ['scrBoot', 'scrHome', 'scrQueue', 'scrLobby', 'scrEnd'].forEach(x => $(x).classList.toggle('hide', x !== 'scrBoot')); $('bootMsg').textContent = msg; $('bootLink').hidden = false; $('bootLink').textContent = 'Back to AUREX'; };
if (!window.THREE) { fatal('The 3D engine could not be loaded (three.js from cdnjs). Check your connection or ad-blocker and reload.'); return; }
if (!window.AurexPenPhysics || !window.PenGfx) { fatal('A game file failed to load. Reload the page (Ctrl+F5). If it keeps happening, tell the owner.'); return; }
if (!window.io) { fatal('Could not reach the game server connection (socket.io). Reload the page.'); return; }
const P = window.AurexPenPhysics, C = P.C, Gfx = window.PenGfx;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let sock = null, off = 0, me = -1, uid = -1, actorList = [], room = null, players = [], league = false, phase = 'menu', turn = null, role = 'none', st = { kicks: [0, 0], goals: [0, 0], log: [[], []], first: 0 }, cards = [0, 0];
let aim = { ax: 0, ay: 0.4, curve: 0 }, charging = false, chargeT0 = 0, power = 0, sent = false, ballAll = [], strikeAt = 0, shotClockTimer = null, timers = [], lastKin = '0,0', runInfo = null, started = false, sbReady = false, myTeam = null;
const keys = new Set(), srv = () => Date.now() + off, later = (ms, fn) => { const t = setTimeout(fn, Math.max(0, ms)); timers.push(t); return t; };
const clearLater = () => { timers.forEach(clearTimeout); timers = []; };
const crest = t => (t && t.hasLogo ? `/api/aurex/teams/${t.id}/logo` : 'aurex-logo-sm.png');
const text = (id, v) => { const e = $(id); if (e) e.textContent = v; };
const show = (id, on = true) => { const e = $(id); if (e) e.classList.toggle('hide', !on); };

/* ------------------------------------------------------------------ sound (synthesised, no files) */
const Snd = (() => {
  let ac = null, master = null, crowd = null;
  const ctx = () => { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination); } catch (e) { return null; } } if (ac.state === 'suspended') ac.resume(); return ac; };
  const tone = (f, d, type = 'sine', v = 0.25, f2) => { const a = ctx(); if (!a) return; const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.setValueAtTime(f, a.currentTime); if (f2) o.frequency.exponentialRampToValueAtTime(f2, a.currentTime + d); g.gain.setValueAtTime(v, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + d); o.connect(g); g.connect(master); o.start(); o.stop(a.currentTime + d + 0.02); };
  const noise = (d, v = 0.3, hp = 400, lp = 6000) => { const a = ctx(); if (!a) return; const n = a.sampleRate * d, b = a.createBuffer(1, n, a.sampleRate), x = b.getChannelData(0); for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * (1 - i / n); const s = a.createBufferSource(); s.buffer = b; const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = Math.sqrt(hp * lp); f.Q.value = 0.5; const g = a.createGain(); g.gain.value = v; s.connect(f); f.connect(g); g.connect(master); s.start(); };
  return {
    unlock: ctx,
    whistle() { tone(2900, 0.5, 'sine', 0.22); tone(3100, 0.5, 'sine', 0.16); },
    kick() { tone(150, 0.12, 'sine', 0.55, 60); noise(0.08, 0.35, 300, 3000); },
    net() { noise(0.55, 0.28, 800, 7000); },
    post() { tone(1250, 0.5, 'triangle', 0.3, 900); tone(2480, 0.35, 'sine', 0.12); },
    save() { tone(110, 0.15, 'sine', 0.5, 70); noise(0.1, 0.3, 200, 2500); },
    bounce() { tone(190, 0.07, 'sine', 0.25, 120); },
    beep() { tone(1500, 0.08, 'square', 0.1); },
    varIn() { tone(660, 0.15, 'square', 0.12); later(160, () => tone(880, 0.15, 'square', 0.12)); later(320, () => tone(1320, 0.25, 'square', 0.12)); },
    card() { tone(300, 0.3, 'sawtooth', 0.1, 220); },
    roar(big) { const a = ctx(); if (!a) return; if (crowd) { try { crowd.stop(); } catch (e) { } } const d = big ? 3.2 : 1.6, n = a.sampleRate * d, b = a.createBuffer(1, n, a.sampleRate), x = b.getChannelData(0); for (let i = 0; i < n; i++) { const e = Math.sin(Math.PI * i / n); x[i] = (Math.random() * 2 - 1) * e; } const s = a.createBufferSource(); s.buffer = b; const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.4; const g = a.createGain(); g.gain.value = big ? 0.55 : 0.3; s.connect(f); f.connect(g); g.connect(master); s.start(); crowd = s; },
    ambience() { const a = ctx(); if (!a || Snd._amb) return; const n = a.sampleRate * 3, b = a.createBuffer(1, n, a.sampleRate), x = b.getChannelData(0); let l = 0; for (let i = 0; i < n; i++) { l = (l + (Math.random() * 2 - 1) * 0.1) * 0.98; x[i] = l; } const s = a.createBufferSource(); s.buffer = b; s.loop = true; const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; const g = a.createGain(); g.gain.value = 0.35; s.connect(f); f.connect(g); g.connect(master); s.start(); Snd._amb = true; },
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
  const mt = $('modeTag'); mt.textContent = league ? 'LEAGUE MATCH' : 'FRIENDLY · NOT COUNTED IN THE TABLE'; mt.classList.toggle('league', league);
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
function flashCard(who, name) { text('cardText', `YELLOW CARD · ${String(name).toUpperCase()}`); show('cardflash', true); Snd.card(); Gfx.refSignal('card'); later(2200, () => show('cardflash', false)); }
function roleText() {
  if (!turn) return '';
  const k = turn.retake ? ' <b>(retake)</b>' : '';
  if (role === 'shooter') return `<b>YOU SHOOT</b>${k} — aim with the mouse / finger, hold <b>SPACE</b> to charge, release to shoot. <b>Q / E</b> curve · <b>F</b> feint (early in the run-up only).`;
  if (role === 'keeper') return `<b>YOU ARE THE GOALKEEPER</b>${k} — <b>A / D</b> move, <b>W</b> steps off the line (VAR watches!), dive: <b>← →</b> low · <b>Q / E</b> high · <b>↑</b> jump.`;
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
function setScreen(id) { ['scrBoot', 'scrHome', 'scrQueue', 'scrLobby', 'scrEnd'].forEach(s => show(s, s === id)); $('menu').classList.remove('off'); }
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
  sock = io('/aurex-pen', { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 3000 });
  sock.on('connect_error', e => { text('bootMsg', e && /AUTH/.test(e.message) ? 'Please sign in to AUREX first.' : 'Connection problem: ' + (e && e.message)); if (e && /AUTH/.test(e.message)) { $('bootLink').hidden = false; sock.close(); } });
  sock.on('connect', () => { text('conn', ''); syncClock(); });
  sock.on('disconnect', () => { if (phase !== 'end' && phase !== 'menu') text('conn', 'Connection lost — reconnecting… (you have 60 s)'); });
  sock.on('hello', d => { myTeam = d.team; uid = d.user.id; setScreen('scrHome'); if (d.team) { text('myTeamName', d.team.name); text('myPlayer', d.user.username); $('myCrest').src = crest(d.team); } else { text('myTeamName', 'No active team'); text('myPlayer', d.user.username); } text('homeErr', d.error || ''); ['bQuick', 'bCreate', 'bJoin'].forEach(b => { $(b).disabled = !!d.error; }); });
  sock.on('err', d => { text('homeErr', d.message || d.code); if (d.code === 'OPENED_ELSEWHERE') { text('conn', d.message); } });
  sock.on('queue', () => setScreen('scrQueue'));
  sock.on('joined', d => { me = d.you; if (d.uid != null) uid = d.uid; setScreen('scrLobby'); lobbyUI(d.room); });
  sock.on('lobby', d => { if (phase === 'menu') lobbyUI(d.room); });
  sock.on('room', d => { room = d.room; if (!started) return; const off2 = d.room.players.findIndex(p => p && !p.on); text('conn', off2 >= 0 ? (off2 === me ? '' : 'Opponent disconnected — waiting up to 60 s for them to return…') : ''); });
  sock.on('match:start', onMatchStart);
  sock.on('sync', onSync);
  sock.on('turn', onTurn);
  sock.on('kp', d => Gfx.keeperTo(d.x, d.kz));
  sock.on('runup', d => { phase = 'runup'; strikeAt = d.strikeAt; Gfx.startRun(d.runAt, d.strikeAt); Gfx.setStrike(d.strikeAt); runInfo = d; Gfx.setAim(aim.ax, aim.ay, aim.curve, false, 0); show('power', false); if (role === 'shooter') show('runbar', true); text('hint', role === 'shooter' ? 'Feint now = legal (green) · late = illegal (red)' : 'Read the run-up… dive when you decide'); });
  sock.on('feint', d => { Gfx.feint(d.progress, d.strikeAt); Gfx.setStrike(d.strikeAt); strikeAt = d.strikeAt; runInfo.strikeAt = d.strikeAt; runInfo.feintAt = d.progress; });
  sock.on('kick', onKick);
  sock.on('ball', onBall);
  sock.on('dive', d => { Gfx.setDive(d.dir, d.hi, d.tdMs); if (d.x != null) Gfx.keeperTo(d.x, d.kz); });
  sock.on('var:start', d => { phase = 'var'; varStart(d); });
  sock.on('result', onResult);
  sock.on('end', onEnd);
}
function syncClock() {
  const samples = []; let n = 0;
  const one = () => { const t0 = Date.now(); sock.emit('ping:t', sv => { const t1 = Date.now(), rtt = t1 - t0; samples.push({ rtt, off: sv - (t0 + rtt / 2) }); if (++n < 6) setTimeout(one, 80); else { samples.sort((a, b) => a.rtt - b.rtt); off = samples[0].off; } }); };
  one();
}

function applyScore(d) { if (d.kicks) { st = { kicks: d.kicks, goals: d.goals, log: d.log, first: d.first != null ? d.first : st.first }; } if (d.cards) cards = d.cards; renderBoard(); }

function onMatchStart(d) {
  started = true; league = d.league; players = d.players; phase = 'intro';
  st = { kicks: [0, 0], goals: [0, 0], log: [[], []], first: d.first }; $('menu').classList.add('off'); show('hud', true); show('pad', false); Snd.unlock(); Snd.ambience();
  buildActors();
  try { initGfx(); Gfx.setActors(actorList); } catch (e) { $('menu').classList.remove('off'); fatal('Graphics could not start: ' + e.message + '. Your browser/device needs WebGL — try Chrome or Safari, and turn on hardware acceleration.'); sock.emit('leave'); return; }
  Gfx.setClock(srv); renderBoard(); text('role', ''); text('hint', ''); show('runbar', false); show('power', false); show('curveui', false);
  Gfx.startIntro(srv(), d.introMs); Gfx.crowdCheer(true); Snd.roar(true);
  players.forEach((p, i) => { text('itn' + i, p.team.name); text('ipn' + i, names(p)); $('icr' + i).src = crest(p.team); });
  const it = $('intro'); it.className = ''; show('intro', true); const first = players[d.first];
  text('coin', `COIN TOSS · ${first.team.name.toUpperCase()} KICKS FIRST`); const nIn = Math.min(2600, d.introMs * 0.28), tOut = d.introMs * 0.66;
  later(nIn, () => it.classList.add('names-in')); later(tOut, () => { it.classList.add('names-out'); it.classList.add('title-in'); show('hud', false); Snd.roar(false); }); later(d.introMs - 200, () => { $('fade').classList.add('on'); }); later(d.introMs + 150, () => { show('hud', true); show('intro', false); $('fade').classList.remove('on'); Gfx.stopIntro(); });
}
function initGfx() {
  if (sbReady) return; sbReady = true;
  try { Gfx.init($('gl')); } catch (e) { console.error(e); sbReady = false; throw e; }
  requestAnimationFrame(loop);
}
function safeLoop() { try { Gfx.render(); } catch (e) { if (!safeLoop.warned) { safeLoop.warned = true; console.error('render error', e); text('conn', 'Graphics error: ' + e.message); } } }
function loop() { safeLoop(); tickClock(); inputFrame(); requestAnimationFrame(loop); }

function onSync(d) {
  started = true; me = d.you; if (d.uid != null) uid = d.uid; league = d.league; players = d.room.players.filter(Boolean); st = { kicks: d.kicks, goals: d.goals, log: d.log, first: d.first }; cards = d.cards || [0, 0];
  $('menu').classList.add('off'); show('hud', true); buildActors(); initGfx(); Gfx.setActors(actorList); Gfx.setClock(srv); renderBoard(); text('conn', '');
  if (d.turn && d.phase === 'aim') onTurn({ ...d.turn, ...d, k: d.turn.k }); else { phase = d.phase; Gfx.camera('result', true); text('hint', 'Reconnected — next kick coming up…'); }
}

function onTurn(d) {
  clearLater(); show('hud', true); show('intro', false); $('fade').classList.remove('on'); Gfx.stopIntro(); turn = d; phase = 'aim'; started = true; role = d.shooterUser === uid ? 'shooter' : d.keeperUser === uid ? 'keeper' : 'spectator'; sent = false; charging = false; power = 0; aim = { ax: 0, ay: 0.4, curve: 0 }; ballAll = []; runInfo = null; lastKin = '0,0';
  applyScore(d); show('var', false); show('callbox', false); $('banner').classList.remove('show'); show('runbar', false);
  Gfx.clearTurn(); Gfx.setRole(role, actorOf(d.shooterUser), actorOf(d.keeperUser)); Gfx.keeperSnap(0, 0); Gfx.camera(role === 'keeper' ? 'keeper' : 'shooter', true);
  Gfx.setAim(aim.ax, aim.ay, 0, role === 'shooter', 0); Gfx.crowdCheer(false);
  $('role').innerHTML = roleText(); show('power', role === 'shooter'); show('curveui', role === 'shooter'); $('power').firstElementChild.style.width = '0%'; updateCurveUI();
  show('padShoot', role === 'shooter'); show('padKeep', role === 'keeper'); show('pad', role !== 'spectator');
  text('hint', role === 'shooter' ? 'Wait for the whistle…' : role === 'keeper' ? 'Position yourself on the line — wait for the whistle' : 'Your teammate or opponent is on — watch and get ready');
  if (d.retake) banner('RETAKE', '#ffd23f', 1400);
  later(d.whistleAt - srv(), () => { if (phase === 'aim') { Snd.whistle(); Gfx.refSignal('whistle'); text('hint', role === 'shooter' ? 'WHISTLE — you can shoot!' : 'WHISTLE — the kicker is about to shoot'); } });
}
function onKick(d) {
  phase = 'flight'; strikeAt = d.strikeAt; Gfx.setStrike(d.strikeAt); Gfx.camera(role === 'keeper' ? 'flightK' : 'flightS'); show('runbar', false); show('power', false); text('hint', '');
  Gfx.keeperTo(d.keeper.x, d.keeper.kz); later(d.strikeAt - srv(), () => { Snd.kick(); }); Gfx.shake(0.02);
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
  if (final === 'goal') { banner('GOAL!' + sub, '#41e0a0', 2600); Gfx.react('goal', sa, ka); Gfx.crowdCheer(true); Snd.roar(true); later(900, () => { const rs = ballAll.filter(Boolean); if (rs.length > 8) { banner('REPLAY', '#cbd3e1', 2600); Gfx.startReplay(rs, 0.3, 'goalcam'); } }); }
  else if (final === 'save') { banner('SAVED!' + sub, '#5b95ff', 2400); Gfx.react('save', sa, ka); Snd.roar(false); }
  else if (final === 'post') { banner('OFF THE POST!' + sub, '#ffd23f', 2400); Gfx.react('miss', sa, ka); Snd.roar(false); }
  else { banner((d.timeout ? 'TOO SLOW!' : 'MISSED!') + sub, '#ff6b86', 2400); Gfx.react('miss', sa, ka); }
  text('hint', '');
}
function onEnd(d) {
  phase = 'end'; clearLater(); show('var', false); show('callbox', false); show('pad', false); text('role', ''); text('hint', ''); text('conn', ''); applyScore(d); Gfx.setAim(0, 0, 0, false, 0); Gfx.camera('end');
  const win = d.winner === me, draw = d.winner == null; text('endTitle', draw ? 'DRAW' : win ? 'VICTORY' : 'DEFEAT'); text('endScore', `${d.table[0]} – ${d.table[1]}`);
  text('endTeams', `${players[0].team.name}  vs  ${players[1].team.name}`);
  const mt = $('endMode'); mt.textContent = d.league ? 'LEAGUE MATCH — recorded in the AUREX table' : 'FRIENDLY — not counted in the table (the league has not started)'; mt.className = 'tagline' + (d.league ? ' league' : '');
  const why = { normal: 'Won after the regular five kicks.', sudden_death: 'Won in sudden death.', cap_draw: 'Level after 10 kicks each — the match is a draw.', forfeit: d.winner === me ? 'Your opponent left the match — 3–0 awarded.' : 'You left the match — 3–0 awarded to your opponent.' }[d.reason] || '';
  text('endWhy', why + (d.saved ? '' : '  (Warning: the result could not be saved — tell the owner.)'));
  if (!draw) { Gfx.react('goal', Math.max(0, actorList.findIndex(a => a.side === d.winner)), Math.max(0, actorList.findIndex(a => a.side !== d.winner))); Snd.roar(true); Gfx.crowdCheer(true); }
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
}
bindUI(); connect();
window.__pen = { get state() { return { phase, role, me, st, turn, league }; } };    // handy for debugging
})();
