'use strict';
// Plain-Node HTTP API (no framework dependency). Mounted by Express at /api/aurex.
const { createCore } = require('./core');
const { HttpError, err } = require('./errors');

function createApi({ store, env = process.env }) {
  const core = createCore({ store, env });
  const isProd = env.NODE_ENV === 'production';
  const COOKIE = 'aurex_sid', MAX_AGE = 30 * 24 * 3600;

  const clientIp = req => {
    if (env.TRUST_PROXY !== '0' && req.headers['x-forwarded-for']) { const p = String(req.headers['x-forwarded-for']).split(','); return p[p.length - 1].trim(); }
    return req.socket.remoteAddress || 'unknown';
  };
  const readCookie = req => { const m = new RegExp('(?:^|; *)' + COOKIE + '=([^;]+)').exec(req.headers.cookie || ''); return m ? m[1] : null; };
  const cookie = (req, value, maxAge) => {
    const secure = isProd || req.headers['x-forwarded-proto'] === 'https';
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  };
  function readJson(req, limit) {
    return new Promise((resolve, reject) => {
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reject(err(415, 'JSON_REQUIRED', 'Send application/json.'));
      let size = 0; const chunks = [];
      req.on('data', c => { size += c.length; if (size > limit) { reject(err(413, 'TOO_LARGE', 'Request is too large.')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { const t = Buffer.concat(chunks).toString('utf8'); const b = t ? JSON.parse(t) : {}; resolve(b && typeof b === 'object' && !Array.isArray(b) ? b : {}); } catch (_) { reject(err(400, 'BAD_JSON', 'Malformed JSON.')); } });
      req.on('error', reject);
    });
  }
  function send(res, status, payload, headers) {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(body);
  }

  const routes = [];
  const R = (method, re, opts, fn) => routes.push({ method, re: new RegExp('^' + re + '/?$'), opts, fn });
  const ID = '(?<id>\\d{1,9})';
  // --- auth
  R('POST', '/auth/register', {}, async c => { const s = await core.register(c.ip, c.ua, c.body); return { status: 201, json: { user: s.user, recoveryCode: s.recoveryCode }, session: s.token }; });
  R('POST', '/auth/login', {}, async c => { const s = await core.login(c.ip, c.ua, c.body); return { json: { user: s.user }, session: s.token }; });
  R('POST', '/auth/logout', { auth: 'optional' }, async c => { if (c.session) await core.logout(c.session.tokenHash); return { json: { ok: true }, clear: true }; });
  R('GET', '/auth/me', { auth: 'optional' }, async c => ({ json: c.user ? await core.me(c.user) : { user: null, team: null } }));
  R('POST', '/auth/change-password', { auth: true }, async c => ({ json: await core.changePassword(c.user, c.session.tokenHash, c.body) }));
  R('POST', '/auth/recover', {}, async c => ({ json: await core.recover(c.ip, c.body) }));
  R('POST', '/owner/bootstrap', { auth: true }, async c => ({ json: await core.bootstrapOwner(c.ip, c.user, c.body) }));
  // --- teams
  R('GET', '/teams/public', {}, async () => ({ json: { teams: await core.publicTeams() } }));
  R('POST', '/teams', { auth: true, limit: 300 * 1024 }, async c => ({ status: 201, json: { team: await core.registerTeam(c.user, c.body) } }));
  R('POST', '/teams/mine/captain', { auth: true }, async c => ({ json: { team: await core.setCaptainByTeam(c.user, c.body) } }));
  R('GET', `/teams/${ID}/logo`, { auth: 'optional' }, async c => {
    const l = await core.teamLogo(c.user, +c.params.id); if (!l) throw err(404, 'NOT_FOUND', 'No logo.');
    return { raw: l.data, type: l.mime };
  });
  // --- football club selection
  R('GET', '/football-clubs', { auth: 'optional' }, async c => ({ json: { clubs: await core.footballClubs(), mine: c.user ? await core.myFootballClub(c.user) : null } }));
  R('POST', '/select-club', { auth: true }, async c => ({ json: await core.selectFootballClub(c.user, c.body.footballClubId) }));
  R('GET', '/my-club', { auth: true }, async c => ({ json: { mine: await core.myFootballClub(c.user) } }));
  // --- owner panel (every route re-checks the OWNER role on the server)
  const A = { auth: true, owner: true };
  R('GET', '/admin/teams', A, async c => ({ json: { teams: await core.admin.listTeams(c.user, c.query.get('status')) } }));
  R('GET', `/admin/teams/${ID}`, A, async c => ({ json: { team: await core.admin.getTeam(c.user, +c.params.id) } }));
  R('POST', `/admin/teams/${ID}/approve`, A, async c => ({ json: { team: await core.admin.approve(c.user, +c.params.id, c.body) } }));
  R('POST', `/admin/teams/${ID}/reject`, A, async c => ({ json: { team: await core.admin.reject(c.user, +c.params.id, c.body) } }));
  R('POST', `/admin/teams/${ID}/activate`, A, async c => ({ json: { team: await core.admin.activate(c.user, +c.params.id) } }));
  R('POST', `/admin/teams/${ID}/suspend`, A, async c => ({ json: { team: await core.admin.suspend(c.user, +c.params.id, c.body) } }));
  R('POST', `/admin/teams/${ID}/captain`, A, async c => ({ json: { team: await core.admin.setCaptain(c.user, +c.params.id, c.body) } }));
  R('POST', `/admin/teams/${ID}/team-id`, A, async c => ({ json: { team: await core.admin.setTeamCode(c.user, +c.params.id, c.body) } }));
  R('GET', '/admin/players', A, async c => ({ json: { players: await core.admin.listPlayers(c.user) } }));
  R('POST', `/admin/players/${ID}/suspend`, A, async c => ({ json: { player: await core.admin.setPlayerStatus(c.user, +c.params.id, 'suspended', c.body) } }));
  R('POST', `/admin/players/${ID}/unsuspend`, A, async c => ({ json: { player: await core.admin.setPlayerStatus(c.user, +c.params.id, 'active', c.body) } }));
  R('POST', `/admin/players/${ID}/role`, A, async c => ({ json: { player: await core.admin.setRole(c.user, +c.params.id, c.body) } }));
  R('GET', '/admin/football-clubs', A, async c => ({ json: { clubs: await core.admin.listFootballClubs(c.user) } }));
  R('POST', `/admin/teams/${ID}/football-club`, A, async c => ({ json: await core.admin.selectFootballClub(c.user, +c.params.id, c.body) }));
  R('DELETE', `/admin/teams/${ID}/football-club`, A, async c => ({ json: await core.admin.releaseFootballClub(c.user, +c.params.id) }));
  R('GET', '/admin/audit', A, async c => ({ json: { entries: await core.admin.listAudit(c.user) } }));

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://local');
      const path = url.pathname.replace(/^\/api\/aurex/, '') || '/';
      let hit = null, pathMatched = false;
      for (const r of routes) { const m = r.re.exec(path); if (m) { pathMatched = true; if (r.method === req.method) { hit = { r, params: m.groups || {} }; break; } } }
      if (!hit) return send(res, pathMatched ? 405 : 404, { error: { code: pathMatched ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', message: 'Not found.' } });
      const { r, params } = hit, write = req.method !== 'GET' && req.method !== 'HEAD';
      if (write) { // CSRF: custom header forces a CORS preflight (which we never grant) + same-origin check
        const origin = req.headers.origin;
        if (req.headers['x-aurex-client'] !== 'web' || (origin && origin !== 'null' && new URL(origin).host !== req.headers.host)) throw err(403, 'CSRF_BLOCKED', 'Request blocked.');
      }
      const c = { req, ip: clientIp(req), ua: req.headers['user-agent'], params, query: url.searchParams, user: null, session: null, body: {} };
      if (r.opts.auth) {
        const s = await core.authenticate(readCookie(req));
        if (s) { c.user = s.user; c.session = s; }
        if (r.opts.auth === true && !c.user) throw err(401, 'AUTH_REQUIRED', 'Sign in to continue.');
        if (r.opts.owner && c.user.role !== 'OWNER') throw err(403, 'FORBIDDEN', 'Owner access required.');
      }
      if (write) c.body = await readJson(req, r.opts.limit || 16 * 1024);
      const out = await r.fn(c);
      if (out.raw) { res.writeHead(200, { 'Content-Type': out.type, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" }); return res.end(out.raw); }
      const headers = {};
      if (out.session) headers['Set-Cookie'] = cookie(req, out.session, MAX_AGE);
      if (out.clear) headers['Set-Cookie'] = cookie(req, '', 0);
      send(res, out.status || 200, out.json, headers);
    } catch (e) {
      if (e instanceof HttpError) {
        const h = e.extra && e.extra.retryAfter ? { 'Retry-After': String(e.extra.retryAfter) } : undefined;
        return send(res, e.status, { error: { code: e.code, message: e.message, ...(e.extra && e.extra.field ? { field: e.extra.field } : {}) } }, h);
      }
      console.error('[aurex] unhandled:', e);
      send(res, 500, { error: { code: 'SERVER_ERROR', message: 'Something went wrong on our side.' } });
    }
  }
  handler.core = core;
  return handler;
}
module.exports = { createApi };
