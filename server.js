const express = require('express'), http = require('http'), { Server } = require('socket.io');
const app = express(), srv = http.createServer(app), io = new Server(srv);
app.use(express.static(__dirname));
const rooms = {}; let queue = null;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const tok = () => Math.random().toString(36).slice(2, 12);
function mkRoom() {
  let c; do c = Math.random().toString(36).slice(2, 6).toUpperCase(); while (rooms[c]);
  return rooms[c] = { code: c, p: [null, null], team: ['BAR', 'RMA'], ready: [false, false], score: [0, 0], kicks: [0, 0], log: [[], []], turn: 0, phase: 'lobby', kx: 0, dive: null, shot: null, waiting: false };
}
const state = r => ({ code: r.code, team: r.team, score: r.score, kicks: r.kicks, log: r.log, turn: r.turn, phase: r.phase, conn: r.p.map(p => !!(p && p.on)) });
const emit = (r, ev, d) => io.to(r.code).emit(ev, d);
function seat(r, s, i) {
  r.p[i] = { id: s.id, token: tok(), on: true }; s.join(r.code); s.data = { code: r.code, i };
  s.emit('joined', { code: r.code, i, token: r.p[i].token });
  emit(r, 'room', state(r));
}
function join(s, r) {
  const i = r.p[0] ? (r.p[1] ? -1 : 1) : 0;
  if (i < 0) return s.emit('err', 'Room is full');
  seat(r, s, i);
}
function begin(r) {
  if (r.phase !== 'lobby' || !r.ready[0] || !r.ready[1]) return;
  r.phase = 'idle'; emit(r, 'start', state(r)); setTimeout(() => nextTurn(r), 2500);
}
function nextTurn(r) {
  if (r.p.some(p => !p || !p.on)) { r.waiting = true; return; }
  r.waiting = false; r.phase = 'aim'; r.dive = null; r.shot = null;
  emit(r, 'turn', { ...state(r), slot: r.kicks[r.turn] % 5 });
  clearTimeout(r.to); r.to = setTimeout(() => shoot(r, { ax: 0, ay: .3, pw: .5 }), 25000);
}
function shoot(r, s) {
  if (r.phase !== 'aim') return; clearTimeout(r.to);
  const pw = clamp(+s.pw || 0, 0, 1), j = Math.pow(pw, 3) * 1.1;
  const ax = clamp(+s.ax || 0, -1, 1) + (Math.random() - .5) * j, ay = clamp(+s.ay || 0, 0, 1) + (Math.random() - .5) * j * .6;
  const tx = ax * 4.5, ty = .2 + clamp(ay, 0, 1.2) * 2.8, T = 1.15 - .65 * pw;
  r.shot = { tx, ty, T, t0: Date.now() }; r.phase = 'flight';
  emit(r, 'shot', { tx, ty, T }); setTimeout(() => resolve(r), T * 1000 + 30);
}
function resolve(r) {
  const { tx, ty, T, t0 } = r.shot; let res;
  if (Math.abs(tx) > 3.66 || ty > 2.44) res = 'miss';
  else if (Math.abs(Math.abs(tx) - 3.66) < .12 || Math.abs(ty - 2.44) < .1) res = 'post';
  else {
    const d = r.dive, kx = d ? d.kx : r.kx; let ex = kx, cy = .9, rx = .8, ry = 1.0;
    if (d) {
      const late = (d.at - t0) > T * 1000 - 280, f = late ? .55 : 1;
      ex = kx + d.dir * 2.6 * f; cy = d.hi ? 1.7 : .8; rx = 1.2; ry = 1.0;
    }
    res = (Math.abs(tx - ex) < rx && Math.abs(ty - cy) < ry) ? 'save' : 'goal';
  }
  const t = r.turn; r.kicks[t]++; if (res === 'goal') r.score[t]++; r.log[t].push(res === 'goal' ? 1 : 0);
  r.phase = 'result'; emit(r, 'result', { res, score: r.score, kicks: r.kicks, log: r.log, tx, ty });
  setTimeout(() => {
    const [a, b] = r.kicks, [x, y] = r.score;
    const over = (a <= 5 && b <= 5 && (a < 5 || b < 5)) ? (x > y + (5 - b) || y > x + (5 - a)) : (a === b && x !== y);
    if (over) { r.phase = 'end'; emit(r, 'end', { score: r.score, winner: x > y ? 0 : 1, team: r.team }); }
    else { r.turn = 1 - r.turn; nextTurn(r); }
  }, 3200);
}
io.on('connection', s => {
  const R = () => s.data && rooms[s.data.code];
  s.on('create', () => { const r = mkRoom(); seat(r, s, 0); });
  s.on('join', c => { const r = rooms[String(c).toUpperCase().trim()]; r ? join(s, r) : s.emit('err', 'Room not found'); });
  s.on('quick', () => {
    if (queue && rooms[queue] && !rooms[queue].p[1]) { join(s, rooms[queue]); queue = null; }
    else { const r = mkRoom(); queue = r.code; seat(r, s, 0); }
  });
  s.on('rejoin', ({ code, token }) => {
    const r = rooms[code]; const i = r && r.p.findIndex(p => p && p.token === token);
    if (!r || i < 0) return s.emit('err', 'Session expired');
    r.p[i].id = s.id; r.p[i].on = true; s.join(code); s.data = { code, i };
    s.emit('joined', { code, i, token }); emit(r, 'room', state(r));
    if (r.phase !== 'lobby') s.emit('start', state(r));
    if (r.waiting) nextTurn(r);
  });
  s.on('ready', t => {
    const r = R(); if (!r || r.phase !== 'lobby') return; const i = s.data.i;
    const want = t === 'RMA' ? 'RMA' : 'BAR';
    if (r.ready[1 - i] && r.team[1 - i] === want) r.team[i] = want === 'BAR' ? 'RMA' : 'BAR'; else r.team[i] = want;
    r.ready[i] = true; emit(r, 'room', state(r)); begin(r);
  });
  s.on('shoot', d => { const r = R(); if (r && s.data.i === r.turn) shoot(r, d); });
  s.on('kx', x => { const r = R(); if (r && s.data.i !== r.turn && r.phase !== 'result') { r.kx = clamp(+x || 0, -3, 3); s.to(r.code).emit('kx', r.kx); } });
  s.on('dive', d => {
    const r = R(); if (!r || s.data.i === r.turn || r.phase !== 'flight' || r.dive) return;
    r.dive = { dir: clamp(Math.round(+d.dir || 0), -1, 1), hi: !!d.hi, kx: clamp(+d.kx || 0, -3, 3), at: Date.now() };
    s.to(r.code).emit('dive', r.dive);
  });
  s.on('disconnect', () => {
    const r = R(); if (!r) return; const p = r.p[s.data.i]; if (!p || p.id !== s.id) return;
    p.on = false; emit(r, 'room', state(r));
    setTimeout(() => {
      if (!p.on && r.phase !== 'end') { emit(r, 'err', 'Opponent left the match'); r.phase = 'end'; clearTimeout(r.to); }
      if (r.p.every(q => !q || !q.on)) delete rooms[r.code];
    }, 60000);
  });
});
srv.listen(process.env.PORT || 3000, () => console.log('PENALTY OUT on port ' + (process.env.PORT || 3000)));
