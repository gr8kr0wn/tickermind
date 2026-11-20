const path = require('path');
const express = require('express');
const cors = require('cors');
const cfg = require('./config');
const db = require('./db');
const routes = require('./routes');
const worker = require('./worker');
const { seed } = require('./seed');

function createApp() {
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
  app.use('/api', routes);
  app.use('/api', (_q, res) => res.status(404).json({ error: 'Not found' }));
  app.use(express.static(path.join(__dirname, '..', '..', 'web'), { extensions: ['html'] }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error('[error]', err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
  });
  return app;
}

async function main() {
  if (cfg.sessionSecretIsRandom) console.warn('[warn] SESSION_SECRET not set: sign-ins reset on every restart. Set it in .env');
  const app = createApp();
  app.listen(cfg.port, () => console.log(`TickerMind on http://localhost:${cfg.port}  (db: ${db.kind}, chain: ${cfg.chainEnabled ? 'on' : 'off'}, demo: ${cfg.demoMode})`));
  await seed({ withReports: process.env.SEED_REPORTS !== '0' }).catch((e) => console.warn('[seed]', e.message));
  worker.start();
}

if (require.main === module) main();
module.exports = { createApp };
