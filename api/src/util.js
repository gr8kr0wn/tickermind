class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (m) => new HttpError(400, m);
const forbidden = (m = 'Forbidden') => new HttpError(403, m);
const notFound = (m = 'Not found') => new HttpError(404, m);
const conflict = (m) => new HttpError(409, m);

// per-key async mutex (single-process safety for balance check -> post sequences)
const chains = new Map();
function withLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// tiny TTL cache
function ttlCache(ms) {
  const m = new Map();
  return {
    get(k) {
      const e = m.get(k);
      if (e && e.exp > Date.now()) return e.v;
      m.delete(k);
      return undefined;
    },
    set(k, v) {
      m.set(k, { v, exp: Date.now() + ms });
      if (m.size > 500) m.delete(m.keys().next().value);
      return v;
    },
  };
}

async function fetchJson(url, opts = {}, timeoutMs = 12000) {
  const r = await fetchText(url, opts, timeoutMs, true);
  return JSON.parse(r);
}
async function fetchText(url, opts = {}, timeoutMs = 12000, throwOnHttp = true) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok && throwOnHttp) throw new Error(`HTTP ${r.status} for ${url}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

module.exports = { HttpError, bad, forbidden, notFound, conflict, withLock, wrap, ttlCache, fetchJson, fetchText };
