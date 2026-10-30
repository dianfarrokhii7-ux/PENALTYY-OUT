# PENALTY OUT
Online 3D penalty shootout for two real players (Three.js + Node + Express + Socket.IO).

## Run locally
1. Install Node 18+.
2. `npm install`
3. `npm start`
4. Open http://localhost:3000 in two browser tabs (or two devices on your LAN: http://YOUR-PC-IP:3000).
5. Player 1: Create Room, share the 4-letter code. Player 2: type it, Join Room. Both press Ready.

## Deploy on Render
1. Push this folder to a GitHub repository.
2. Render > New > Web Service > connect the repo.
3. Build command: `npm install`. Start command: `npm start`. Runtime: Node.
4. Deploy, then share the `https://...onrender.com` URL. (Free instances sleep after idle; first load can take ~30 s.)

## Controls
Shooter (PC): Arrows aim, A/D fine aim, hold Space to charge, release to shoot. More power = faster but less accurate.
Keeper (PC): A/D move, then Left/Right dive low, hold Up + Left/Right dive high, Space jump. Dive only works after the ball is struck.
Mobile: on-screen pad (aim arrows + SHOOT, or move + dive buttons).

## How it works
The server decides every result: it receives the shot (aim, power) and the keeper's dive, adds power-based inaccuracy, and after the ball's flight time compares the ball's target with the keeper's reach (goal / save / post / miss). Clients animate the same shot from the same parameters. Disconnected players have 60 s to reconnect (session kept in sessionStorage).
