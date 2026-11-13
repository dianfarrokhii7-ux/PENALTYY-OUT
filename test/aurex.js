// AUREX phase 1: accounts, roles, owner bootstrap, teams, owner panel – real HTTP against the API with the in-memory store.
const http = require('http'); const assert = require('assert');
const { createApi } = require('../aurex/api'); const mem = require('../aurex/store-mem');
const V = require('../aurex/validate'); const C = require('../aurex/crypto');

const KEY = 'test-owner-key-0123456789-abcdef';
const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40, 1)]).toString('base64');

class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async req(method, path, body, headers = {}) {
    const h = { 'content-type': 'application/json', 'x-aurex-client': 'web', ...headers }; if (this.cookie) h.cookie = this.cookie;
    const r = await fetch(this.base + '/api/aurex' + path, { method, headers: h, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    const set = r.headers.get('set-cookie'); if (set) this.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), set };
  }
  get(p) { return this.req('GET', p); } post(p, b, h) { return this.req('POST', p, b, h); }
}
const ok = (r, s = 200) => { assert.strictEqual(r.status, s, JSON.stringify(r.body)); return r.body; };
const code = (r, s, c) => { assert.strictEqual(r.status, s, JSON.stringify(r.body)); assert.strictEqual(r.body.error.code, c, JSON.stringify(r.body)); };

(async () => {
  // ---- unit: validation + crypto
  assert.throws(() => V.username('ab')); assert.throws(() => V.username('has space')); assert.throws(() => V.username('Admin'));
  assert.throws(() => V.password('short')); assert.throws(() => V.password('password1')); assert.throws(() => V.password('Sam_Player1', 'sam_player1'));
  assert.strictEqual(V.teamName('  Red   Falcons '), 'Red Falcons'); assert.throws(() => V.teamName('<b>x</b>'));
  assert.throws(() => V.logo('data:image/svg+xml;base64,PHN2Zz4=')); assert.throws(() => V.logo('data:image/png;base64,' + Buffer.alloc(20, 7).toString('base64')));
  assert.throws(() => V.logo('data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(200 * 1024)]).toString('base64')));
  assert(V.logo(png).mime === 'image/png' && V.logo(null) === null);
  const h = await C.hashSecret('Correct-Horse'); assert(await C.verifySecret('Correct-Horse', h) && !(await C.verifySecret('correct-horse', h)) && !h.includes('Correct'));
  assert(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(C.makeRecoveryCode()));

  // ---- server (no OWNER key configured yet)
  let store = mem.create();
  if (process.env.TEST_DATABASE_URL) { // optional: run the very same checks against a real (throw-away!) PostgreSQL database
    const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    store = require('../aurex/store-pg').create(process.env.TEST_DATABASE_URL); await store.migrate();
    await pool.query('TRUNCATE audit_log, team_members, teams, sessions, users, meta RESTART IDENTITY CASCADE'); await store.migrate(); await pool.end();
    console.log('(running against PostgreSQL)');
  }
  const env = { NODE_ENV: 'test', TRUST_PROXY: '0' };
  const api = createApi({ store, env });
  const srv = http.createServer(api); await new Promise(r => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const A = () => new Client(base);

  // ---- registration & login
  const sam = A(), lia = A(), ola = A(), eve = A();
  code(await sam.post('/auth/register', { username: 'sam_01', password: 'Strong-Pass-1', confirmPassword: 'nope' }), 400, 'PASSWORD_MISMATCH');
  code(await sam.post('/auth/register', { username: 'x', password: 'Strong-Pass-1', confirmPassword: 'Strong-Pass-1' }), 400, 'INVALID_USERNAME');
  const reg = ok(await sam.post('/auth/register', { username: 'sam_01', password: 'Strong-Pass-1', confirmPassword: 'Strong-Pass-1', role: 'OWNER' }), 201);
  assert.strictEqual(reg.user.role, 'PLAYER', 'nobody can pick OWNER at sign-up'); assert(reg.recoveryCode);
  const setc = (await sam.post('/auth/logout')).set; assert(/Max-Age=0/.test(setc));
  code(await A().post('/auth/register', { username: 'SAM_01', password: 'Strong-Pass-1', confirmPassword: 'Strong-Pass-1' }), 409, 'USERNAME_TAKEN');
  ok(await lia.post('/auth/register', { username: 'lia_02', password: 'Strong-Pass-2', confirmPassword: 'Strong-Pass-2' }), 201);
  ok(await ola.post('/auth/register', { username: 'ola_03', password: 'Strong-Pass-3', confirmPassword: 'Strong-Pass-3' }), 201);
  ok(await eve.post('/auth/register', { username: 'eve_04', password: 'Strong-Pass-4', confirmPassword: 'Strong-Pass-4' }), 201);
  const lg = await sam.post('/auth/login', { username: 'Sam_01', password: 'Strong-Pass-1' }); ok(lg);
  assert(/HttpOnly/.test(lg.set) && /SameSite=Lax/.test(lg.set), 'session cookie flags');
  assert.strictEqual(ok(await sam.get('/auth/me')).user.username, 'sam_01');
  assert.strictEqual(ok(await A().get('/auth/me')).user, null);
  code(await A().post('/auth/login', { username: 'sam_01', password: 'bad' }), 401, 'INVALID_CREDENTIALS');
  code(await A().post('/auth/login', { username: 'ghost', password: 'bad' }), 401, 'INVALID_CREDENTIALS');
  // second device works independently
  const sam2 = A(); ok(await sam2.post('/auth/login', { username: 'sam_01', password: 'Strong-Pass-1' })); assert.strictEqual(ok(await sam2.get('/auth/me')).user.username, 'sam_01');

  // ---- CSRF / transport rules
  code(await sam.req('POST', '/auth/logout', {}, { 'x-aurex-client': '' }), 403, 'CSRF_BLOCKED');
  code(await sam.post('/auth/change-password', {}, { origin: 'https://evil.example' }), 403, 'CSRF_BLOCKED');
  code(await sam.req('POST', '/teams', {}, { 'content-type': 'text/plain' }), 415, 'JSON_REQUIRED');

  // ---- owner panel is closed to players (server-side)
  for (const p of ['/admin/teams', '/admin/players', '/admin/audit']) { code(await sam.get(p), 403, 'FORBIDDEN'); code(await A().get(p), 401, 'AUTH_REQUIRED'); }
  code(await sam.post('/admin/teams/1/approve', {}), 403, 'FORBIDDEN');

  // ---- owner bootstrap: closed until the server key exists, then one-shot
  code(await sam.post('/owner/bootstrap', { key: KEY }), 404, 'NOT_FOUND');
  env.AUREX_OWNER_KEY = KEY;
  code(await sam.post('/owner/bootstrap', { key: 'wrong-key' }), 403, 'BAD_KEY');
  assert.strictEqual(ok(await sam.post('/owner/bootstrap', { key: KEY })).role, 'OWNER');
  assert.strictEqual(ok(await sam.get('/auth/me')).user.role, 'OWNER');
  code(await lia.post('/owner/bootstrap', { key: KEY }), 404, 'NOT_FOUND'); // disabled after first use
  assert.strictEqual(ok(await lia.get('/auth/me')).user.role, 'PLAYER');

  // ---- team registration rules
  const T = (o = {}) => ({ name: 'Red Falcons', teamPassword: 'falcon-pass', player1Username: 'lia_02', player2Username: 'ola_03', logo: png, ...o });
  code(await lia.post('/teams', T({ player1Username: 'ola_03' })), 400, 'PLAYER1_MUST_BE_YOU');
  code(await lia.post('/teams', T({ player2Username: 'lia_02' })), 400, 'SAME_PLAYER');
  code(await lia.post('/teams', T({ player2Username: 'nobody_99' })), 404, 'PLAYER2_NOT_FOUND');
  code(await lia.post('/teams', T({ logo: 'data:image/svg+xml;base64,PHN2Zz4=' })), 400, 'INVALID_LOGO');
  code(await lia.post('/teams', T({ teamPassword: '123' })), 400, 'INVALID_TEAM_PASSWORD');
  code(await A().post('/teams', T()), 401, 'AUTH_REQUIRED');
  const team = ok(await lia.post('/teams', T()), 201).team;
  assert.strictEqual(team.status, 'pending'); assert.strictEqual(team.teamCode, null); assert.strictEqual(team.captain, 'lia_02'); assert.strictEqual(team.members.length, 2);
  assert(!JSON.stringify(team).includes('scrypt') && !JSON.stringify(team).includes('s1$'), 'no hashes in responses');
  code(await lia.post('/teams', T({ name: 'Other' })), 409, 'ALREADY_IN_TEAM');
  code(await eve.post('/teams', T({ player1Username: 'eve_04', player2Username: 'ola_03', name: 'Blue Owls' })), 409, 'PLAYER2_BUSY');
  code(await eve.post('/teams', T({ player1Username: 'eve_04', player2Username: 'sam_01', name: 'red falcons' })), 409, 'TEAM_NAME_TAKEN');
  assert.strictEqual(ok(await ola.get('/auth/me')).team.status, 'pending');
  assert.strictEqual(ok(await A().get('/teams/public')).teams.length, 0, 'pending teams are not public');
  assert.strictEqual((await A().get(`/teams/${team.id}/logo`)).status, 404, 'pending logo is private');
  assert.strictEqual((await lia.get(`/teams/${team.id}/logo`)).headers.get('content-type'), 'image/png');

  // ---- approval workflow
  assert.strictEqual(ok(await sam.get('/admin/teams?status=pending')).teams.length, 1);
  code(await sam.post(`/admin/teams/${team.id}/activate`, {}), 409, 'BAD_STATE');
  code(await sam.post(`/admin/teams/${team.id}/suspend`, { reason: 'x y z' }), 409, 'BAD_STATE');
  const appr = ok(await sam.post(`/admin/teams/${team.id}/approve`, {})).team;
  assert.strictEqual(appr.status, 'approved'); assert.strictEqual(appr.teamCode, 'AX-0001');
  code(await sam.post(`/admin/teams/${team.id}/approve`, {}), 409, 'BAD_STATE');
  assert.strictEqual(ok(await sam.post(`/admin/teams/${team.id}/activate`, {})).team.status, 'active');
  assert.strictEqual(ok(await A().get('/teams/public')).teams[0].teamCode, 'AX-0001');
  assert.strictEqual((await A().get(`/teams/${team.id}/logo`)).status, 200);
  code(await sam.post(`/admin/teams/${team.id}/suspend`, {}), 400, 'REASON_REQUIRED');
  assert.strictEqual(ok(await sam.post(`/admin/teams/${team.id}/suspend`, { reason: 'Rules check' })).team.status, 'suspended');
  assert.strictEqual(ok(await lia.get('/auth/me')).team.suspendReason, 'Rules check');
  assert.strictEqual(ok(await sam.post(`/admin/teams/${team.id}/activate`, {})).team.status, 'active');

  // Team ID + captain management
  code(await sam.post(`/admin/teams/${team.id}/team-id`, { teamCode: 'bad' }), 400, 'INVALID_TEAM_ID');
  assert.strictEqual(ok(await sam.post(`/admin/teams/${team.id}/team-id`, { teamCode: 'ax-0042' })).team.teamCode, 'AX-0042');
  const olaId = team.members.find(m => m.username === 'ola_03').userId, liaId = team.members.find(m => m.username === 'lia_02').userId;
  code(await lia.post('/teams/mine/captain', { userId: olaId, teamPassword: 'wrong-pass' }), 403, 'WRONG_TEAM_PASSWORD');
  code(await ola.post('/teams/mine/captain', { userId: liaId, teamPassword: 'falcon-pass' }), 403, 'NOT_CAPTAIN');
  assert.strictEqual(ok(await lia.post('/teams/mine/captain', { userId: olaId, teamPassword: 'falcon-pass' })).team.captain, 'ola_03');
  assert.strictEqual(ok(await sam.post(`/admin/teams/${team.id}/captain`, { userId: liaId })).team.captain, 'lia_02');
  code(await sam.post(`/admin/teams/${team.id}/captain`, { userId: 1 }), 400, 'NOT_A_MEMBER');

  // reject frees the players
  const t2 = ok(await eve.post('/teams', T({ player1Username: 'eve_04', player2Username: 'sam_01', name: 'Blue Owls' })), 201).team;
  code(await sam.post(`/admin/teams/${t2.id}/reject`, { reason: '' }), 400, 'REASON_REQUIRED');
  assert.strictEqual(ok(await sam.post(`/admin/teams/${t2.id}/reject`, { reason: 'Logo missing' })).team.status, 'rejected');
  const eveMe = ok(await eve.get('/auth/me')); assert.strictEqual(eveMe.team.status, 'rejected'); assert.strictEqual(eveMe.team.rejectReason, 'Logo missing');
  ok(await eve.post('/teams', T({ player1Username: 'eve_04', player2Username: 'sam_01', name: 'Blue Owls' })), 201); // may re-apply, same name allowed again

  // ---- player management
  const players = ok(await sam.get('/admin/players')).players;
  assert(players.every(p => !('passHash' in p) && !('recoveryHash' in p)), 'no hashes in player list');
  const oid = players.find(p => p.username === 'ola_03').id;
  code(await sam.post(`/admin/players/${oid}/role`, { role: 'OWNER', password: 'bad' }), 403, 'WRONG_PASSWORD');
  code(await sam.post(`/admin/players/${players.find(p => p.username === 'sam_01').id}/suspend`, {}), 400, 'SELF_ACTION');
  ok(await sam.post(`/admin/players/${oid}/suspend`, { reason: 'abuse' }));
  code(await ola.get('/auth/me').then(r => (r.body.user === null ? { status: 401, body: { error: { code: 'AUTH_REQUIRED' } } } : r)), 401, 'AUTH_REQUIRED'); // sessions revoked
  code(await A().post('/auth/login', { username: 'ola_03', password: 'Strong-Pass-3' }), 403, 'ACCOUNT_SUSPENDED');
  ok(await sam.post(`/admin/players/${oid}/unsuspend`, {}));
  ok(await ola.post('/auth/login', { username: 'ola_03', password: 'Strong-Pass-3' }));
  assert.strictEqual(ok(await sam.post(`/admin/players/${oid}/role`, { role: 'OWNER', password: 'Strong-Pass-1' })).player.role, 'OWNER');
  assert.strictEqual(ok(await sam.post(`/admin/players/${oid}/role`, { role: 'PLAYER', password: 'Strong-Pass-1' })).player.role, 'PLAYER');
  const audit = ok(await sam.get('/admin/audit')).entries.map(e => e.action);
  for (const a of ['owner.bootstrap', 'team.approve', 'team.reject', 'team.suspend', 'team.captain', 'player.suspend', 'player.role']) assert(audit.includes(a), 'audit has ' + a);

  // ---- password change / recovery
  code(await lia.post('/auth/change-password', { oldPassword: 'nope', newPassword: 'Another-Pass-9', confirmPassword: 'Another-Pass-9' }), 403, 'WRONG_PASSWORD');
  const lia2 = A(); ok(await lia2.post('/auth/login', { username: 'lia_02', password: 'Strong-Pass-2' }));
  ok(await lia.post('/auth/change-password', { oldPassword: 'Strong-Pass-2', newPassword: 'Another-Pass-9', confirmPassword: 'Another-Pass-9' }));
  assert.strictEqual(ok(await lia2.get('/auth/me')).user, null, 'other devices are signed out'); assert.strictEqual(ok(await lia.get('/auth/me')).user.username, 'lia_02');
  const rc = (await new Client(base).post('/auth/register', { username: 'kim_05', password: 'Strong-Pass-5', confirmPassword: 'Strong-Pass-5' })).body.recoveryCode;
  code(await A().post('/auth/recover', { username: 'kim_05', recoveryCode: 'AAAA-AAAA-AAAA-AAAA', newPassword: 'Brand-New-Pass1', confirmPassword: 'Brand-New-Pass1' }), 400, 'INVALID_RECOVERY');
  const rec = ok(await A().post('/auth/recover', { username: 'KIM_05', recoveryCode: rc.toLowerCase(), newPassword: 'Brand-New-Pass1', confirmPassword: 'Brand-New-Pass1' }));
  assert(rec.recoveryCode && rec.recoveryCode !== rc, 'a new recovery code replaces the spent one');
  code(await A().post('/auth/recover', { username: 'kim_05', recoveryCode: rc, newPassword: 'Brand-New-Pass2', confirmPassword: 'Brand-New-Pass2' }), 400, 'INVALID_RECOVERY');
  ok(await A().post('/auth/login', { username: 'kim_05', password: 'Brand-New-Pass1' }));

  // ---- brute-force limiter
  let limited = false; const brute = A();
  for (let i = 0; i < 12; i++) { const r = await brute.post('/auth/login', { username: 'kim_05', password: 'wrong-' + i }); if (r.status === 429) { limited = true; assert(r.headers.get('retry-after')); break; } }
  assert(limited, 'login is rate limited');

  // ---- unknown routes
  assert.strictEqual((await A().get('/nope')).status, 404); assert.strictEqual((await A().req('GET', '/auth/login')).status, 405);
  srv.close(); console.log('aurex phase 1: all checks passed'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
