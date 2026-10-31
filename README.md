# PENALTY OUT
Online 3D football for two real players — **Penalty Shootout** (`/`) and **Friendly Match 6v6** (`/friendly.html`).
Three.js + Node + Express + Socket.IO. Teams: Barcelona, Real Madrid, Mashin Jadid.

## Run locally
1. Node 18+ → `npm install` → `npm start` → open http://localhost:3000 in two tabs / devices (LAN: `http://YOUR-PC-IP:3000`).
2. First visit asks for a **username** (saved in the browser, shown to your opponent; tap the “Player: …” button to change it).
3. Player 1: Create Room and share the 4-letter code. Player 2: Join Room. Pick a team, press Ready.

`npm test` runs the headless simulation (`test/sim.js`), the dribble-rate check and a real two-client socket test.

## Deploy on Render
Upload all files (not the ZIP) to the root of the GitHub repo → Render › New › Web Service → Build `npm install`, Start `npm start`.
Health check URL: `/health`. After updating, both players must close old tabs and create a NEW room.

## v6 changes
- **6v6** friendly (was 5v5). Formations: 2-2-1, 2-1-2, 3-1-1, 1-3-1, 1-2-2 + CUSTOM sliders.
- **Player ratings** (OVR, PAC, SHO, PAS, DRI, DEF; goalkeepers have a GK rating) that change the game:
  PAC = run speed · SHO = shot power and accuracy · PAS = pass speed and accuracy · DEF = tackle success and fewer fouls (vs the carrier's DRI) · GK = reaction time, dive error and save chance (also in penalties).
  Edit all squads/ratings in **`shared.js`** (`SQUADS`). Index 0 of every squad is the goalkeeper; the first 6 entries are the default XI, the rest the bench.
- **Bench & substitutions**: Real Madrid +Ferland Mendy, Raúl Asencio, David Jiménez, Federico Valverde, Vinícius Júnior; Barcelona +Pedri, Jules Koundé, Pau Cubarsí, Álvaro Cortés, Frenkie de Jong, Karim Adeyemi, Anthony Gordon. Build your XI in the line-up screen (tap a slot, then a bench player) and make up to 5 substitutions during the match while play is stopped (SUBS button / **B**).
- **Mashin Jadid**: Amir X Mod (GK), Mohammad Gimer, Mohammad Iron, Parham Gameplay, Kiasha (+ placeholder “Mashin Jadid #6”, because 6v6 needs six players). Available in both modes. Kit colours: black/gold.
- **Dribble** button: **R** on PC, DRIBBLE on mobile. 40 % the skill move works (burst past nearby defenders), 60 % the touch is too heavy and the ball runs loose. 1.4 s cooldown.
- **Classic ball** (black pentagons) in both modes — procedural, `ball.glb` is no longer used (you may delete it).
- **Mobile graphics**: shadows on phones, up to 2× pixel ratio with an automatic resolution scaler that holds ~50+ fps, sharper pitch texture.
- Usernames, match statistics screen (possession, shots, passes, tackles, fouls, dribbles), auto-switch to the nearest defender, smarter zone AI (shifts with the ball, marks, presses, offers passing angles).
- Server hardening: only client files are served (no `server.js` / `package.json`), input rate-limits, sanitised names, `/health`.

## Controls
PC: WASD move · Shift sprint · F pass · E cross · Space shoot/header (hold) · **R dribble** · C tackle · V switch · **B subs**.
Mobile: joystick + SWITCH / TACKLE / CROSS / PASS / **DRIBBLE** / SHOOT / SPRINT, SUBS button (top right).
Penalties inside a match: shooter camera behind the ball (aim, hold SHOOT); defender controls the keeper from behind the goal. Free kicks: behind-the-ball camera for the taker only.
Penalty shootout mode: aim with arrows, hold Space; keeper A/D + arrows to dive (touch pad on mobile).
