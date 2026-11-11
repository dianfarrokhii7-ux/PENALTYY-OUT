# Architecture

```
server.js        Express + Socket.IO entry: static client files (whitelist), /health, penalty-shootout rooms
friendly.js      6v6 friendly: authoritative simulation (30 Hz) + room/lobby sockets on namespace /friendly
shared.js        Squads, ratings, formations, name rules (Node + browser). Browser-only: classic ball, Quality, name prompt
lineup.js        Browser line-up editor (drag & drop pitch, presets, auto XI, save slots)
gamepad.js       Gamepad (PS4/Xbox…) -> synthetic keyboard events for both clients
game.js          Penalty-shootout client          friendly-game.js  Friendly-match client (scene, input, HUD, subs)
test/            squads, lineup editor, simulation, dribble rate, two-client socket integration
```

## Friendly match model
* The server owns all state. Clients send `in` ({mx,mz,sp}, only on change / every 300 ms) and `act` ({t:pass|shoot|cross|tk|sw|dr|dive|sub…}).
* Every tick (30 Hz) the server runs AI, physics, rules (throw-in, corner, goal kick, fouls/cards, free kick, penalty) and emits `snap`
  (positions, ball, clock, score, controlled players) plus one-shot `ev` events (goal, foul, sub, dribble…). Clients interpolate.
* Ratings (`shared.js`): PAC run speed · SHO shot power/accuracy · PAS pass speed/accuracy · DRI vs tackles · DEF tackling/fouls · GK saves.
* Line-up: `{ form, order }` or `{ form: 'custom', pos, order }`; `order[slot]` = squad index, slot 0 is always squad index 0 (goalkeeper).
  The server validates every line-up (permutation, bounds, clamped positions) before use.

## Settings, extra time, shootout
`room.set = { night, extra, pens }` is chosen by the host in phase `settings` (after line-ups). `tick()` runs two extra halves (`ET_HALF`) when level and `extra`; if still level and `pens`
(and both humans online) the phase becomes `shootout`: `friendly.js` asks `server.js` (`hooks.shootout`) for a pre-seated penalty room and sends each player `{code, token}`;
the client stores it as the normal `po` session and reloads `/` where `game.js` rejoins it. Env overrides for tests: `PO_HALF`, `PO_ET`.

## Tuning
Constants are at the top of `friendly.js` (pitch size, half length, dribble chance, max substitutions) and in `shared.js` (squads/formations).
