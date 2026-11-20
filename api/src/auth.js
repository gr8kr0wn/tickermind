// Wallet sign-in: server issues a stateless HMAC nonce, wallet signs a message, server returns
// a short-lived HMAC session token. No cookies, no stored sessions.
const crypto = require('crypto');
const { ethers } = require('ethers');
const cfg = require('./config');
const { HttpError } = require('./util');

const hmac = (s) => crypto.createHmac('sha256', cfg.sessionSecret).update(s).digest('base64url');
const NONCE_TTL = 10 * 60 * 1000;
const SESSION_TTL = 12 * 60 * 60 * 1000;

function makeNonce() {
  const ts = Date.now().toString();
  const rand = crypto.randomBytes(8).toString('hex');
  const body = `${ts}.${rand}`;
  return `${body}.${hmac('n:' + body)}`;
}
function checkNonce(nonce) {
  const parts = String(nonce).split('.');
  if (parts.length !== 3) return false;
  const body = parts[0] + '.' + parts[1];
  const expect = hmac('n:' + body);
  if (parts[2].length !== expect.length) return false;
  const ok = crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expect));
  return ok && Date.now() - Number(parts[0]) < NONCE_TTL;
}
const messageFor = (nonce) => `Sign in to TickerMind\n\nThis only proves you own this wallet. It costs no gas.\n\nNonce: ${nonce}`;

function verifyLogin(address, signature, nonce) {
  if (!ethers.isAddress(address)) throw new HttpError(400, 'Bad address');
  if (!checkNonce(nonce)) throw new HttpError(401, 'Nonce expired, try again');
  let rec;
  try {
    rec = ethers.verifyMessage(messageFor(nonce), signature);
  } catch (_) {
    throw new HttpError(401, 'Bad signature');
  }
  if (rec.toLowerCase() !== address.toLowerCase()) throw new HttpError(401, 'Signature does not match wallet');
  const payload = Buffer.from(JSON.stringify({ a: rec.toLowerCase(), e: Date.now() + SESSION_TTL })).toString('base64url');
  return { token: `${payload}.${hmac('s:' + payload)}`, address: rec.toLowerCase() };
}

function readToken(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const [payload, sig] = h.slice(7).split('.');
  if (!payload || !sig) return null;
  const expect = hmac('s:' + payload);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return d.e > Date.now() ? d.a : null;
  } catch (_) {
    return null;
  }
}

const optionalAuth = (req, _res, next) => {
  req.wallet = readToken(req);
  next();
};
const requireAuth = (req, _res, next) => {
  req.wallet = readToken(req);
  if (!req.wallet) return next(new HttpError(401, 'Connect and sign in with your wallet'));
  next();
};

module.exports = { makeNonce, messageFor, verifyLogin, optionalAuth, requireAuth };
