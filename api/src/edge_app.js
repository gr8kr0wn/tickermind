// Supabase Edge Function entry (bundled by scripts/build-edge.js). Same routes as the Node server;
// the background worker becomes /api/internal/tick, called every 30s by pg_cron.
const express = require('express');
const cors = require('cors');
const cfg = require('./config');
const routes = require('./routes');
const worker = require('./worker');
const { seed } = require('./seed');
const db = require('./db');

const BASES = ['/api', '/tickermind-api/api'];
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((_q, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(cors({ origin: cfg.allowedOrigin }));
app.use(express.json({ limit: '50kb' }));

// after any write request, start working on queued tasks in the background (up to the function time limit)
app.use(BASES, (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'OPTIONS') {
    res.on('finish', () => {
      try { globalThis.EdgeRuntime.waitUntil(worker.tick()); } catch (_) {}
    });
  }
  next();
});

let lastTick = 0;
app.all(BASES.map((b) => b + '/internal/tick'), async (_req, res) => {
  if (Date.now() - lastTick < 5000) return res.json({ ok: true, skipped: true });
  lastTick = Date.now();
  const hasAgents = (await db.list('agents', { limit: 1 })).length > 0;
  if (!hasAgents) await seed({ withReports: process.env.SEED_REPORTS !== '0' }).catch((e) => console.warn('[seed]', e.message));
  await worker.tick();
  await worker.maybeSchedule();
  res.json({ ok: true });
});

app.use(BASES, routes);
app.use(BASES, (_q, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err instanceof SyntaxError ? 400 : 500);
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
});

app.listen(8000);
