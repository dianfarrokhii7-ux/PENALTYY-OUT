# AUREX CHAMPIONSHIP – phase 1 (accounts, teams, owner panel)

Open `/aurex` on the running server. The PENALTY OUT home screen has an AUREX CHAMPIONSHIP button.

## Deploy on Render
1. Push this repo to GitHub, then on Render create a **Blueprint** from it. `render.yaml` creates the web service and the PostgreSQL database `penalty-out-db` and wires `DATABASE_URL` for you.
2. In the web service → Environment, add `AUREX_OWNER_KEY` (a long random string, 24+ characters, e.g. `openssl rand -base64 32`). Never put it in the repo, HTML or JS.
3. Open `/aurex`, create your normal account (you get a recovery code – save it), then open `/aurex#/owner-setup` and enter the key. The account becomes OWNER.
4. The bootstrap is one-shot: once an owner exists it answers 404 forever. Afterwards you can delete `AUREX_OWNER_KEY` from Render.

Tables are created automatically at boot (`aurex/schema.sql`, idempotent). Without `DATABASE_URL` AUREX refuses to run in production (nothing is ever kept in memory or local storage there).

## Security model
* Passwords and recovery codes: scrypt (N=32768) with per-secret salt, constant-time compare. Hashes never leave the server.
* Sessions: random 256-bit token in an `HttpOnly; SameSite=Lax; Secure` cookie, only its SHA-256 is stored in PostgreSQL. 30-day expiry, many devices allowed. Changing the password signs out all other devices; suspending a player signs out everywhere.
* Roles are decided on the server from the database on every request. Every `/api/aurex/admin/*` route requires OWNER; the UI hiding buttons is only cosmetic. Nobody can choose a role at sign-up.
* CSRF: state-changing calls need the `X-Aurex-Client` header (forces a CORS pre-flight that is never granted) and a same-origin `Origin`.
* Rate limits (login, sign-up, recovery, bootstrap, team requests) are held per server instance in memory.
* The page is served with a strict Content-Security-Policy (no inline script or style). All server text is inserted with `textContent`.
* Every owner action is written to `audit_log` (Owner panel → Activity log).
* Team logos are checked by magic bytes (PNG/JPEG/WebP only, 150 KB) and stored in PostgreSQL, not on the disk.

## API (all under `/api/aurex`)
`POST /auth/register|login|logout|change-password|recover` · `GET /auth/me` · `POST /owner/bootstrap`
`GET /teams/public` · `POST /teams` · `POST /teams/mine/captain` · `GET /teams/:id/logo`
Owner: `GET /admin/teams[?status=]` · `GET /admin/teams/:id` · `POST /admin/teams/:id/approve|reject|activate|suspend|captain|team-id`
`GET /admin/players` · `POST /admin/players/:id/suspend|unsuspend|role` · `GET /admin/audit`

Team status flow: `pending → approved → active ⇄ suspended`, or `pending → rejected` (players may apply again). Team ID (`AX-0001`…) is issued on approval.

## Tests
`npm test` runs everything, including `test/aurex.js` (real HTTP against the API with the in-memory store).
To run the same checks against a real, throw-away PostgreSQL database (it TRUNCATES all AUREX tables):
`TEST_DATABASE_URL=postgres://… node test/aurex.js`

## Not built yet (next phases)
League formats (4/6/8 teams), schedule, results, standings, seasons, awards, archive, statistics, referee reports and MVP storage; the 7-vs-7 two-player-per-team match engine with 30-minute clock, AI referee/VAR; cinematics; training.
