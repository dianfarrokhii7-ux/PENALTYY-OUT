# AUREX PENALTY CUP (replaces the 7-vs-7 idea inside AUREX CHAMPIONSHIP)

Only the AUREX Championship section is touched. Accounts, teams, sessions, club selection and every other game mode are unchanged.

## What it is
- `/aurex-pen` – the live duel. Two players from two **different, active** AUREX teams: one shoots, one keeps goal, roles swap every kick.
- `/aurex#/cup` – table, latest results and the Play button. `/aurex#/admin/league` – owner button **Start league**.

## Rules (server-side, `aurex/pen-rules.js`)
Coin toss, 5 kicks each (early finish when one side can no longer be caught), sudden death after equal kicks, and **a draw if still level after 10 kicks each**.
Table: win 3, draw 1, loss 0; tie-break goal difference, goals for, name. Leaving a started match = forfeit (3–0).

## Friendly vs league
Until the owner presses **Start league** every match is a friendly: it is stored (labelled friendly) but never counted. A match counts only if it **started after** the league was started. A match id can be written once (primary key), so nothing is ever counted twice.

## AI referee + VAR (`aurex/pen-ai.js`)
Rule-based and deterministic, run on the server (IFAB Law 14): goalkeeper off his line, illegal feint, goal-line (whole ball over the whole line). The on-field referee calls clear offences; **VAR is called only for suspicious kicks** (grey-zone keeper position, grey-zone feint, tight goal-line calls). The VAR verdict is what is stored.

## New files / tables
`aurex/pen-rules.js, pen-physics.js, pen-ai.js, pen-room.js`, `aurex-pen.html/.css/.js`, `aurex-pen-3d.js`, `aurex-scoreboard.webp`, tests `test/pen-core.js, pen-room.js, ui/harness.js`.
Additive DB tables (created at boot, idempotent): `aurex_pen_league`, `aurex_pen_matches`. Existing tables are not altered.

## Teams of 1 or 2 players
A team may play with one member (he takes every kick and every keeper turn) or with both registered members. Only the team's registered members can join their team's side (they enter the same room code). Kicks rotate: a team's n-th kick is taken by member n mod 2, the opposing keeper rotates the same way, so each kick is one shooter vs one keeper; the other two watch. If a member drops, his teammate covers; a team only forfeits when every member has been gone for 60 s.
