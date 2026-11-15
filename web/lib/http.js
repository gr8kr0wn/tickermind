// Tiny request/response helpers that work on Vercel functions and on the local dev server.
import { ConfigError } from './env.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);
export const unauthorized = (msg = 'Sign in with your wallet first.') => new HttpError(401, msg);
export const forbidden = (msg = 'You do not own this agent.') => new HttpError(403, msg);
export const notFound = (msg = 'Not found.') => new HttpError(404, msg);

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw bad('Body must be JSON.');
  }
}

export function query(req) {
  const u = new URL(req.url, 'http://localhost');
  return Object.fromEntries(u.searchParams.entries());
}

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

/** Wraps a handler: routes by method, turns thrown errors into JSON responses. */
export function route(methods) {
  return async function handler(req, res) {
    const fn = methods[req.method];
    if (!fn) return send(res, 405, { error: `Method ${req.method} not allowed.` });
    try {
      const out = await fn(req, res);
      if (!res.writableEnded) send(res, 200, out ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      if (err instanceof ConfigError) return send(res, 500, { error: err.message });
      console.error(err);
      return send(res, 500, { error: err?.shortMessage || err?.message || 'Something went wrong.' });
    }
  };
}

export const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
export const isTxHash = (h) => typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h);
export const isUuid = (s) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

export function cleanTicker(t) {
  const s = String(t || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)) throw bad('Enter a valid stock ticker, e.g. NVDA.');
  return s;
}
