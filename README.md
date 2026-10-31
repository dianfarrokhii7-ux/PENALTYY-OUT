# PENALTY OUT
Online 3D penalty shootout for two real players (Three.js + Node + Express + Socket.IO).

## Run locally
1. Install Node 18+.
2. `npm install`
3. `npm start`
4. Open http://localhost:3000 in two browser tabs (or two devices on your LAN: http://YOUR-PC-IP:3000).
5. Player 1: Create Room, share the 4-letter code. Player 2: type it, Join Room. Both press Ready.

## Deploy on Render
1. Upload all project files (not the ZIP itself) to the root of the GitHub repository.
2. Render > New > Web Service > connect the repository.
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Deploy, then share the `https://...onrender.com` URL.

## Update an existing Render deployment
1. Replace `server.js` and `game.js` in the same GitHub repository with these updated files. Keep `index.html`, `style.css`, and `package.json` unless you have made separate changes to them.
2. Commit the changes to the branch connected to Render (usually `main`).
3. In Render, open the existing Web Service and choose **Manual Deploy > Deploy latest commit** if automatic deploy is not enabled.
4. Wait until the deployment status is **Live**, then hard-refresh the game page (Ctrl+Shift+R on Windows; on mobile, close the tab and reopen the link).
5. Both players should close old game tabs, reopen the same new URL, create a NEW room, and test again. Old rooms from the previous server process will not carry over.

## What the update fixes
- Sends a full authoritative room snapshot on reconnect/refresh (`sync` event).
- Restores the current turn, shot animation, goalkeeper dive and result screen instead of replaying only the generic game-start event.
- Clears disconnect timers when a player reconnects.
- Clears stale round timers before starting the next turn.
- Resets goalkeeper position on each new turn and stores the last result for recovery.

## Controls
Shooter (PC): Arrows aim, hold Space to charge, release to shoot. Keeper (PC): A/D move, then Left/Right dive low; Up + Left/Right dive high; Space jumps.
Mobile: on-screen touch controls.

## v2 changes
- Real match ball (ball.glb, FIFA Trionda) replaces the old ball; larger, with ground shadow. Keep ball.glb next to index.html.
- ~5,800 spectators in 9-tier stands, animated, with crowd noise, chant beat, roars on goals and groans on saves/misses.
- Run-up and kick animation; the keeper can only dive once the ball is struck.
- Team selection moved into the lobby: it appears after both players are connected.

## v3: Friendly Match 5v5 (friendly.html)
Open `/friendly.html` (button "Friendly Match 5v5" on the main menu). The penalty mode is unchanged.
- Flow: create/join room -> both connected -> pick teams -> pick formation and swap positions (line-up) -> match.
- 2 halves x 2:30, sides swap at half time. Server simulates all 10 players and the ball at 30 Hz; each human controls one player per team, the other four are AI that return to their posts.
- Rules: kick-off, throw-ins, goal kicks, corners, fouls (tackle from behind is risky), yellow/red cards (red = team plays a man down), free kicks, penalties.
- Controls PC: WASD move, Shift sprint, F pass, Space shoot (hold for power), C tackle, V switch player. Mobile: joystick + SWITCH / TACKLE / PASS / SHOOT / SPRINT buttons.
- Not yet: offside, substitutions, extra time/penalty shootout after a draw, AI difficulty levels.

## v4 changes (friendly mode)
- Players you do not control only hold their own zone: they cannot tackle, pass or shoot. Switch to the ball carrier (it also switches automatically when a teammate wins the ball or receives a pass).
- Goalkeepers: position to narrow the angle, dive for shots (stronger shots are harder to hold), rush out for 1v1s, claim loose balls in the box, and sometimes foul (-> penalty).
- Penalty = same system as the shootout: shooter camera behind the ball (aim, hold SHOOT), the defending player controls the keeper behind the goal (move, then press SHOOT to dive toward the stick). After the kick the shooter's camera returns to the broadcast view; the keeper's stays behind the goal until the result so dive directions stay consistent.
- Free kicks: only the taker gets the behind-the-ball camera; the other player keeps the broadcast view.

## v5 changes (friendly mode)
- New team MASHIN JADID (Kairo GK, Kalbas, Ryven, Bati, Ishin). Kit colours (black/gold) are a placeholder, edit `kitTex`/`K` in friendly-game.js.
- Players near a loose or airborne ball take it (feet or header) and control switches to them. Kick-off: first touch must be a pass.
- Faster, more accurate passes. CROSS button (E on PC, CROSS on mobile; also takes corners). Ball in the air + SHOOT = header (85%) or volley (15%).
- Out of play: ball crossing any line (dribbled, passed, shot or deflected) gives throw-in / goal kick / corner by last touch; ball over the goal line between the posts and under the bar is a goal; posts and crossbar bounce the ball.
- Line-up: any custom formation (sliders per player, live preview) besides 2-1-1 / 1-2-1 / 1-1-2.
- Visuals: sloped 3D nets that ripple on goals, real-time shadows (desktop), grassy pitch texture, sky dome, corner flags, floodlight glow.
- Camera follows the ball in depth and height so the near touchline stays visible.
