// POST { address, issuedAt, signature } → { token, wallet, agentCount }
// GET (Bearer token) → { wallet, agentCount }
import { route, readJson, bad, isAddress, unauthorized } from '../lib/http.js';
import { verifySignIn, issueToken, readSession } from '../lib/auth.js';
import { db, must } from '../lib/db.js';
import { env } from '../lib/env.js';

async function agentCount(wallet) {
  const { count, error } = await db().from('agents').select('id', { count: 'exact', head: true }).eq('owner', wallet).neq('status', 'draft');
  if (error) throw new Error(error.message);
  return count || 0;
}

export default route({
  POST: async (req) => {
    const { address, issuedAt, signature } = await readJson(req);
    if (!isAddress(address) || !issuedAt || !signature) throw bad('address, issuedAt and signature are required.');
    const wallet = await verifySignIn({ address, issuedAt, signature, chainId: env.chainId });
    must(await db().from('profiles').upsert({ wallet, last_login: new Date().toISOString() }, { onConflict: 'wallet' }).select());
    return { token: issueToken(wallet), wallet, agentCount: await agentCount(wallet) };
  },
  GET: async (req) => {
    const s = readSession(req);
    if (!s) throw unauthorized('Session expired.');
    return { wallet: s.wallet, agentCount: await agentCount(s.wallet) };
  },
});
