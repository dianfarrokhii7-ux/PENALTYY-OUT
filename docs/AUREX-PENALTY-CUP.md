# AUREX PENALTY CUP (replaces the 7-vs-7 idea inside AUREX CHAMPIONSHIP)

Only the AUREX Championship section is touched. Accounts, teams, sessions, club selection and every other game mode are unchanged.

## What it is
- `/aurex-pen` – the live duel. Two players from two **different, active** AUREX teams: one shoots, one keeps goal, roles swap every kick.
- `/aurex#/cup` – table, latest results and the Play button. `/aurex#/admin/league` – owner: **Start league**, announce matches, set times, walkovers.

## Rules (server-side, `aurex/pen-rules.js`)
Coin toss, 5 kicks each (early finish when one side can no longer be caught), sudden death after equal kicks, and **a draw if still level after 10 kicks each**.
Table: win 3, draw 1, loss 0; tie-break goal difference, goals for, name. Leaving a started match = forfeit (3–0).

## League format (owner panel → Penalty league)
1. **Start league** works with exactly **4, 6 or 8 ACTIVE teams**; those teams are frozen into the league.
2. **Announce the matches.** Every team plays every other team **once**. The owner picks the two teams and the date/time (or presses *Create all missing pairings* and sets the times afterwards). **The game picks the room code** of each match (5 characters, always starting with a digit, so it can never clash with a friendly room code).
3. **The room opens at the announced time.** Before that the code answers "room opens on …". Only the registered players of the two teams can enter, and only until the match has a result. Both teams can also use the *Enter match* button on the cup page.
4. **Table:** win 3, draw 1, loss 0; tie-break goal difference, goals for, name. Only announced **league fixtures** count; matches from the lobby (quick queue / private code) are **always friendlies**.
5. **After the last league match** the game moves on by itself:
   - **4 teams:** the table leader is the champion.
   - **6 teams:** top 3 go through. 2nd v 3rd play the semi-final; the winner meets the 1st-placed team in the final.
   - **8 teams:** top 4 go through. 1st v 4th and 2nd v 3rd in the semi-finals; the winners meet in the final.
   Semi-finals/final are created automatically (with their room codes); the owner only announces their time. Play-off matches never touch the league table.
6. **Drawn knock-out** (still level after 10 kicks each): the team that finished higher in the league table goes through.
7. **A team does not show up:** the owner awards a **3–0 walkover** (match row → "X wins 3–0"). Leaving a started match is still a 3–0 forfeit.

Room codes are visible only to the owner and to the two teams of that match. A fixture can carry exactly one result (database-enforced); nothing is ever counted twice. Everything the owner does is written to the activity log.

## Cup page extras
- **Next match card** with a live countdown (server clock); at the announced time it switches to *ROOM OPEN* and enables **Enter match** for the two teams.
- **Play-off bracket** (6 and 8 teams): projected from the current table during the round robin, real pairings and scores afterwards, champion slot at the end.
- **Champions ceremony:** trophy, crest, confetti, shown once per browser when the league finishes (button *Replay ceremony*; reduced-motion users get no confetti).
- **Share cards:** 1080×1350 PNG (`aurex-share.js`) of any played match, of the final result on the match end screen, and of the champions. Uses the share sheet on phones, a download elsewhere.
- **Sudden death in the match:** darker edges, a throbbing red rim and a tag (`SCORE OR LOSE`, `SCORE TO WIN`, `SAVE TO WIN`, `SAVE OR LOSE`) on the deciding kick, a heartbeat and a hushed crowd, a gasp on a post or a late save.

## Deleting teams (owner)
Owner panel → Teams: **Delete team completely** on a team, or tick several teams and press **Delete selected**. You must type `DELETE`. A deleted team disappears from the table, its penalty matches, fixtures, logo, club and the link to its players are removed; the players keep their accounts and can register a new team. If a deleted team is in the running league, the game asks a second time: the **whole league is reset** (all announced matches and league results erased, league can be started again). Logged as `team.delete`.

## AI referee + VAR (`aurex/pen-ai.js`)
Rule-based and deterministic, run on the server (IFAB Law 14): goalkeeper off his line, illegal feint, goal-line (whole ball over the whole line). The on-field referee calls clear offences; **VAR is called only for suspicious kicks** (grey-zone keeper position, grey-zone feint, tight goal-line calls). The VAR verdict is what is stored.

## New files / tables
`aurex/pen-rules.js, pen-physics.js, pen-ai.js, pen-room.js`, `aurex-pen.html/.css/.js`, `aurex-pen-3d.js`, `aurex-scoreboard.webp`, tests `test/pen-core.js, pen-room.js, ui/harness.js`.
Additive DB tables (created at boot, idempotent): `aurex_pen_league`, `aurex_pen_matches`, `aurex_pen_fixtures` (new columns on the two penalty tables are added with `ADD COLUMN IF NOT EXISTS`). Accounts/teams tables are not altered. A league that was started under the old rules is simply restarted by the new *Start league* (its old matches have no fixture, so they never count).

## Teams of 1 or 2 players
A team may play with one member (he takes every kick and every keeper turn) or with both registered members. Only the team's registered members can join their team's side (they enter the same room code). Kicks rotate: a team's n-th kick is taken by member n mod 2, the opposing keeper rotates the same way, so each kick is one shooter vs one keeper; the other two watch. If a member drops, his teammate covers; a team only forfeits when every member has been gone for 60 s.

## Team profile (`/aurex#/teams/<id>`)
Every approved/active team has a public profile: logo, name, Team ID, status, captain, squad (captain first), selected football club, league position and points, penalty record (played/won/drawn/lost, goals for/against, goal difference, win rate, form), next announced match (no room code) and the last 10 results. Open it from **Teams**, from the cup table / match lists (team names are links) or from **My team → View team profile**.
API: `GET /api/aurex/teams/:id/profile` (public). Pending, rejected and suspended teams are only visible to their own players and the owner. Code: `core.teamProfile` (`aurex/core.js`), `viewTeamProfile` (`aurex-ui.js`), test `test/team-profile.js`.

## Reporter / گزارشگر (live spectating)
Open **📺 Reporter** in the AUREX menu (or *Watch live matches* on the cup page) = `/aurex-pen?mode=reporter` (optionally `&code=ROOM` to jump straight into one match).
- **Pick a match:** the page lists every running match (friendly, league, semi-final, final) with team names, players, score and viewer count; it refreshes every 4 s. Click one to watch it live.
- **9 camera angles** (keys `1`–`9`, `C` / `→` next, `←` previous, or the buttons): Auto (the normal director), Broadcast, Kicker, Keeper, Net cam, Goal cam, Side, Top view, Ball cam. A chosen angle stays when the next kick starts and is also used for replays.
- **Replays:** every goal is replayed automatically; `R` replays the last kick between kicks, `M` slow-motion on/off, `Esc` stops a replay, `S` mutes the sound. `EXIT` returns to the live list.
- **Joining late is fine:** the server sends a snapshot (score, current kick, ball path so far) so you see the kick that is in the air.
- **Security:** a reporter must be signed in to AUREX (a team is *not* needed). It connects with `?mode=reporter`, which gives it its own socket with **no game handlers at all** (it can never shoot, dive, ready up or take a seat), and it never replaces a player's own game tab. Max 300 reporters per match; list/watch requests are rate-limited. When a room is destroyed all its reporters are released, so a re-used room code can never leak events.
- **Server events (namespace `/aurex-pen`, reporter sockets only):** `spec:list` → `{ list }`, `spec:watch {code}` → `spec:start` (snapshot) then the same `turn / runup / kick / ball / dive / var:start / result / end` events the players get, `spec:leave`, `spec:error`, `spec:end`.

