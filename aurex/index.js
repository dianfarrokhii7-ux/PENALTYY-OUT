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
