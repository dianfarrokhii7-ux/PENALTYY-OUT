const express = require('express');
const path = require('path');
const { TEAM_KEYS, sanitizeName } = require('./shared.js');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const srv = http.createServer(app);
const io = new Server(srv, {
  cors: { origin: true, credentials: true },
  pingInterval: 25000,
  pingTimeout: 20000,
});
app.disable('x-powered-by');
// Only the client files are public — server-side sources (server.js, friendly.js, package.json…) are never served.
const PUBLIC = new Set(['index.html', 'friendly.html', 'style.css', 'friendly.css', 'game.js', 'friendly-game.js', 'shared.js']);
app.get('/health', (_req, res) => res.json({ ok: true, rooms: Object.keys(rooms).length, uptime: Math.round(process.uptime()) }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/:file', (req, res, next) => PUBLIC.has(req.params.file) ? res.sendFile(path.join(__dirname, req.params.file), { maxAge: '5m' }) : next());

const RUN = 0.5;
const rooms = Object.create(null);
let queue = null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const tok = () => Math.random().toString(36).slice(2, 12);

function mkRoom() {
  let code;
  do code = Math.random().toString(36).slice(2, 6).toUpperCase(); while (rooms[code]);
  return rooms[code] = {
    code, p: [null, null], team: ['BAR', 'RMA'], ready: [false, false],
    score: [0, 0], kicks: [0, 0], log: [[], []], turn: 0,
    phase: 'lobby', kx: 0, dive: null, shot: null, lastResult: null,
    waiting: false, winner: null, phaseAt: Date.now(), to: null, resolveTimer: null, advanceTimer: null,
  };
}

function state(r) {
  return {
    code: r.code, team: [...r.team], score: [...r.score], kicks: [...r.kicks],
    log: r.log.map(x => [...x]), turn: r.turn, phase: r.phase,
    conn: r.p.map(p => !!(p && p.on)), ready: [...r.ready], names: r.p.map(p => (p && p.name) || ''),
    kx: r.kx, dive: r.dive ? { ...r.dive } : null,
    shot: r.shot ? { ...r.shot } : null,
    lastResult: r.lastResult ? { ...r.lastResult } : null, winner: r.winner,
    phaseAt: r.phaseAt,
  };
}
const emit = (r, event, data) => io.to(r.code).emit(event, data);
function clearRoomTimers(r) {
  clearTimeout(r.to); clearTimeout(r.resolveTimer); clearTimeout(r.advanceTimer);
}
function seat(r, socket, i, name) {
  r.p[i] = { id: socket.id, token: tok(), on: true, disconnectTimer: null, name: sanitizeName(name) || 'Player' };
  socket.join(r.code);
  socket.data = { code: r.code, i };
  socket.emit('joined', { code: r.code, i, token: r.p[i].token });
  emit(r, 'room', state(r));
}
function join(socket, r, name) {
  const i = r.p[0] ? (r.p[1] ? -1 : 1) : 0;
  if (i < 0) return socket.emit('err', 'Room is full');
  seat(r, socket, i, name);
}
function begin(r) {
  if (r.phase !== 'lobby' || !r.ready[0] || !r.ready[1]) return;
  r.phase = 'idle'; r.phaseAt = Date.now();
  emit(r, 'start', state(r));
  clearTimeout(r.advanceTimer);
  r.advanceTimer = setTimeout(() => nextTurn(r), 1800);
}
function nextTurn(r) {
  clearTimeout(r.to); clearTimeout(r.resolveTimer); clearTimeout(r.advanceTimer);
  if (r.p.some(p => !p || !p.on)) { r.waiting = true; return; }
  r.waiting = false; r.phase = 'aim'; r.phaseAt = Date.now();
  r.dive = null; r.shot = null; r.lastResult = null; r.kx = 0;
  emit(r, 'turn', { ...state(r), slot: r.kicks[r.turn] % 5 });
  r.to = setTimeout(() => shoot(r, { ax: 0, ay: .3, pw: .5 }), 25000);
}
function shoot(r, data) {
  if (r.phase !== 'aim' || !r.p[r.turn] || !r.p[r.turn].on) return;
  clearTimeout(r.to);
  const pw = clamp(Number(data.pw) || 0, 0, 1);
  const spread = Math.pow(pw, 3) * 1.1;
  const ax = clamp(Number(data.ax) || 0, -1, 1) + (Math.random() - .5) * spread;
  const ay = clamp(Number(data.ay) || 0, 0, 1) + (Math.random() - .5) * spread * .6;
  const tx = ax * 4.5, ty = .2 + clamp(ay, 0, 1.2) * 2.8;
  const T = 1.15 - .65 * pw;
  r.shot = { tx, ty, T, t0: Date.now() + RUN * 1000, run: RUN };
  r.phase = 'flight'; r.phaseAt = Date.now(); r.lastResult = null;
  emit(r, 'shot', { ...r.shot });
  r.resolveTimer = setTimeout(() => resolve(r), RUN * 1000 + T * 1000 + 80);
}
function resolve(r) {
  if (r.phase !== 'flight' || !r.shot) return;
  const { tx, ty } = r.shot;
  let result;
  if (Math.abs(tx) > 3.66 || ty > 2.44) result = 'miss';
  else if (Math.abs(Math.abs(tx) - 3.66) < .12 || Math.abs(ty - 2.44) < .1) result = 'post';
  else {
    const dive = r.dive;
    let ex = dive ? dive.kx : r.kx, cy = .9, rx = .8, ry = 1;
    if (dive) {
      const late = (dive.at - r.shot.t0) > r.shot.T * 1000 - 280;
      ex = dive.kx + dive.dir * 2.6 * (late ? .55 : 1);
      cy = dive.hi ? 1.7 : .8; rx = 1.2;
    }
    result = (Math.abs(tx - ex) < rx && Math.abs(ty - cy) < ry) ? 'save' : 'goal';
  }
  const teamIndex = r.turn;
  r.kicks[teamIndex]++;
  if (result === 'goal') r.score[teamIndex]++;
  r.log[teamIndex].push(result === 'goal' ? 1 : 0);
  r.phase = 'result'; r.phaseAt = Date.now();
  r.lastResult = { res: result, score: [...r.score], kicks: [...r.kicks], log: r.log.map(x => [...x]), tx, ty, at: r.phaseAt };
  emit(r, 'result', r.lastResult);
  r.advanceTimer = setTimeout(() => {
    const [a, b] = r.kicks, [x, y] = r.score;
    const regulationOver = a >= 5 && b >= 5;
    const decidedEarly = (a <= 5 && b <= 5 && (a < 5 || b < 5)) && (x > y + (5 - b) || y > x + (5 - a));
    const suddenDeathOver = regulationOver && a === b && x !== y;
    if (decidedEarly || suddenDeathOver) {
      r.phase = 'end'; r.phaseAt = Date.now(); r.winner = x > y ? 0 : 1;
      emit(r, 'end', { score: [...r.score], winner: r.winner, team: [...r.team] });
    } else {
      r.turn = 1 - r.turn;
      nextTurn(r);
    }
  }, 3200);
}

io.on('connection', socket => {
  const roomForSocket = () => socket.data && rooms[socket.data.code];

  socket.on('create', d => { const r = mkRoom(); seat(r, socket, 0, d && d.name); });
  socket.on('join', d => {
    const code = typeof d === 'string' ? d : d && d.code, r = rooms[String(code || '').toUpperCase().trim()];
    r ? join(socket, r, d && d.name) : socket.emit('err', 'Room not found');
  });
  socket.on('quick', d => {
    const name = d && d.name;
    if (queue && rooms[queue] && !rooms[queue].p[1]) { join(socket, rooms[queue], name); queue = null; }
    else { const r = mkRoom(); queue = r.code; seat(r, socket, 0, name); }
  });

  socket.on('rejoin', payload => {
    const code = payload && String(payload.code || '').toUpperCase();
    const token = payload && payload.token;
    const r = rooms[code];
    const i = r ? r.p.findIndex(p => p && p.token === token) : -1;
    if (!r || i < 0) return socket.emit('err', 'Session expired');
    const player = r.p[i];
    clearTimeout(player.disconnectTimer);
    player.id = socket.id; player.on = true;
    socket.join(code); socket.data = { code, i };
    socket.emit('joined', { code, i, token });
    emit(r, 'room', state(r));
    // A full authoritative snapshot replaces the old incomplete `start` replay.
    socket.emit('sync', { ...state(r), slot: r.kicks[r.turn] % 5 });
    if (r.waiting && r.p.every(p => p && p.on)) nextTurn(r);
  });

  socket.on('ready', team => {
    const r = roomForSocket(); if (!r || r.phase !== 'lobby') return;
    const i = socket.data.i;
    const wanted = TEAM_KEYS.includes(team) ? team : 'BAR';
    r.team[i] = r.ready[1 - i] && r.team[1 - i] === wanted ? TEAM_KEYS.find(k => k !== wanted) : wanted;
    r.ready[i] = true;
    emit(r, 'room', state(r)); begin(r);
  });

  socket.on('shoot', data => {
    const r = roomForSocket(); if (r && socket.data.i === r.turn) shoot(r, data || {});
  });
  socket.on('kx', value => {
    const r = roomForSocket();
    if (r && socket.data.i !== r.turn && r.phase === 'aim') {
      r.kx = clamp(Number(value) || 0, -3, 3);
      socket.to(r.code).emit('kx', r.kx);
    }
  });
  socket.on('dive', data => {
    const r = roomForSocket();
    if (!r || socket.data.i === r.turn || r.phase !== 'flight' || r.dive || !r.shot || Date.now() < r.shot.t0 - 150) return;
    r.dive = {
      dir: clamp(Math.round(Number(data && data.dir) || 0), -1, 1),
      hi: !!(data && data.hi), kx: clamp(Number(data && data.kx) || 0, -3, 3), at: Date.now()
    };
    socket.to(r.code).emit('dive', r.dive);
  });

  socket.on('disconnect', () => {
    const r = roomForSocket(); if (!r) return;
    const player = r.p[socket.data.i];
    if (!player || player.id !== socket.id) return;
    player.on = false; emit(r, 'room', state(r));
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = setTimeout(() => {
      if (!player.on && r.phase !== 'end') {
        r.phase = 'end'; r.phaseAt = Date.now(); r.winner = null; clearRoomTimers(r);
        emit(r, 'err', 'Opponent left the match');
        emit(r, 'end', { score: [...r.score], winner: null, team: [...r.team], reason: 'disconnect' });
      }
      if (r.p.every(p => !p || !p.on)) delete rooms[r.code];
    }, 60000);
  });
});

const port = process.env.PORT || 3000;
require('./friendly').attach(io);
srv.listen(port, () => console.log('PENALTY OUT on port ' + port));
