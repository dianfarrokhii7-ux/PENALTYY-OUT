'use strict';
const path = require('path');
const { createApi } = require('./api');

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function createStore(env) {
  if (env.DATABASE_URL) return require('./store-pg').create(env.DATABASE_URL, env);
  if (env.NODE_ENV === 'production' && env.AUREX_ALLOW_MEMORY !== '1') return null; // never run accounts in RAM in production
  console.warn('[aurex] DATABASE_URL not set – using the in-memory store (data is lost on restart).');
  return require('./store-mem').create();
}

function mount(app, env = process.env) {
  const sendPage = file => (_req, res) => { res.set({ 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-cache' }); res.sendFile(path.join(__dirname, '..', file)); };
  app.get(['/aurex', '/aurex.html'], sendPage('aurex.html'));

  // Penalty cup match page: own CSP (three.js from cdnjs, websocket to this host). Everything else about AUREX keeps the strict CSP above.
  const PEN_CSP = "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
  const sendPen = (file, type) => (_req, res) => { res.set({ 'Content-Security-Policy': PEN_CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-cache' }); if (type) res.type(type); res.sendFile(path.join(__dirname, '..', file)); };
  app.get(['/aurex-pen', '/aurex-pen.html'], sendPen('aurex-pen.html'));
  const asset = (route, file, type) => app.get(route, (_req, res) => { res.type(type).set({ 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' }); res.sendFile(path.join(__dirname, '..', file)); });
  asset('/aurex-pen.js', 'aurex-pen.js', 'application/javascript'); asset('/aurex-pen.css', 'aurex-pen.css', 'text/css');
  asset('/aurex-scoreboard.webp', 'aurex-scoreboard.webp', 'image/webp');
  asset('/aurex-pen-physics.js', 'aurex/pen-physics.js', 'application/javascript');

  const store = createStore(env);
  if (!store) {
    console.error('[aurex] DISABLED: set DATABASE_URL (Render PostgreSQL) to enable AUREX CHAMPIONSHIP.');
    app.use('/api/aurex', (_req, res) => res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: 'AUREX is not configured on this server yet.' } }));
    return null;
  }
  const ready = store.migrate().then(() => { console.log(`[aurex] ready (${store.kind})`); return true; }, e => { console.error('[aurex] database setup failed:', e.message); return false; });
  const api = createApi({ store, env });
  const t = setInterval(() => store.purgeExpiredSessions().catch(() => {}), 3600e3); if (t.unref) t.unref();
  app.use('/api/aurex', async (req, res) => {
    if (!(await ready)) return res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'AUREX database is not reachable right now.' } });
    return api(req, res);
  });
  return { store, api };
}
module.exports = { mount, createStore };
