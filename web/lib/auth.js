// Wallet sign-in: the browser signs a timestamped message; we verify it (EOAs and smart wallets)
// and hand back an HMAC-signed session token. No passwords, no cookies.
import crypto from 'node:crypto';
import { verifyMessage } from 'viem';
import { need } from './env.js';
import { unauthorized, forbidden, notFound } from './http.js';
import { publicClient } from './chain.js';
import { db, must } from './db.js';

const SESSION_DAYS = 7;
const MESSAGE_MAX_AGE_MS = 10 * 60 * 1000;

export function signInMessage(address, issuedAt, chainId) {
  return `TickerMind wants you to sign in.\n\nWallet: ${address.toLowerCase()}\nChain: ${chainId}\nIssued: ${issuedAt}\n\nThis does not send a transaction or cost gas.`;
}

export async function verifySignIn({ address, issuedAt, signature, chainId }) {
  const age = Date.now() - Date.parse(issuedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > MESSAGE_MAX_AGE_MS) throw unauthorized('Sign-in message expired. Try again.');
  const message = signInMessage(address, issuedAt, chainId);
  // Fast path for normal wallets (no RPC call), then ERC-1271 / ERC-6492 smart wallets (Coinbase Smart Wallet).
  let ok = false;
  try { ok = await verifyMessage({ address, message, signature }); } catch { ok = false; }
  if (!ok) ok = await publicClient().verifyMessage({ address, message, signature });
  if (!ok) throw unauthorized('Signature did not match this wallet.');
  return address.toLowerCase();
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const hmac = (s) => crypto.createHmac('sha256', need('SESSION_SECRET')).update(s).digest('base64url');

export function issueToken(wallet) {
  const payload = b64(JSON.stringify({ w: wallet, exp: Date.now() + SESSION_DAYS * 864e5 }));
  return `${payload}.${hmac(payload)}`;
}

export function readSession(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = hmac(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { w, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() > exp) return null;
    return { wallet: w };
  } catch {
    return null;
  }
}

export function requireSession(req) {
  const s = readSession(req);
  if (!s) throw unauthorized();
  return s;
}

/** Loads an agent and checks the session wallet owns it. */
export async function requireOwnedAgent(req, agentId) {
  const { wallet } = requireSession(req);
  const agent = must(await db().from('agents').select('*').eq('id', agentId).maybeSingle());
  if (!agent) throw notFound('Agent not found.');
  if (agent.owner !== wallet) throw forbidden();
  return { wallet, agent };
}
