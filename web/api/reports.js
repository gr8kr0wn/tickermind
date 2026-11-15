// GET ?id=<uuid>        → full report (access-checked) + onchain hash verification
// GET ?agentId=<uuid>   → an agent's reports (published for visitors; everything for the owner)
// GET ?recent=1         → latest published reports (landing page)
import { route, query, bad, isUuid, notFound, forbidden } from '../lib/http.js';
import { readSession } from '../lib/auth.js';
import { db, must } from '../lib/db.js';
import { readOrder } from '../lib/chain.js';
import { hashReport } from '../lib/hash.js';

const summary = (r) => ({
  id: r.id, ticker: r.ticker, title: r.title, origin: r.origin, published: r.published, createdAt: r.created_at, hash: r.hash,
  bullScore: r.content?.analysis?.bull_score ?? null, company: r.content?.company?.name ?? r.ticker,
  agent: r.agents ? { id: r.agents.id, name: r.agents.name, sector: r.agents.sector } : undefined,
});

export default route({
  GET: async (req) => {
    const q = query(req);
    const wallet = readSession(req)?.wallet;

    if (q.id) {
      if (!isUuid(q.id)) throw bad('Invalid report id.');
      const r = must(await db().from('reports').select('*, agents(id, name, owner, sector, onchain_id)').eq('id', q.id).maybeSingle());
      if (!r) throw notFound('Report not found.');
      const isOwner = wallet && wallet === r.agents.owner;
      let order = null;
      if (r.origin === 'order') {
        order = must(await db().from('orders').select('id, onchain_order_id, buyer_wallet, rating, fulfill_tx, purchase_tx, amount_usdc').eq('report_id', r.id).maybeSingle());
      }
      const isBuyer = wallet && order && wallet === order.buyer_wallet;
      if (!r.published && !isOwner && !isBuyer) throw forbidden('This report is private. Buy it from the marketplace to read it.');

      // Verification: recompute the hash from stored content, and compare with the hash recorded onchain.
      const recomputed = hashReport(r.content);
      let onchainHash = null;
      if (order) {
        try { onchainHash = (await readOrder(order.onchain_order_id)).reportHash; } catch { onchainHash = null; }
      }
      return {
        report: { ...summary(r), content: r.content, model: r.model },
        agent: { id: r.agents.id, name: r.agents.name, sector: r.agents.sector, onchainId: r.agents.onchain_id },
        verification: {
          storedHash: r.hash,
          recomputedHash: recomputed,
          contentIntact: recomputed === r.hash,
          onchainHash,
          onchainMatch: onchainHash ? onchainHash.toLowerCase() === r.hash.toLowerCase() : null,
        },
        order: order && (isBuyer || isOwner) ? { id: order.id, onchainOrderId: order.onchain_order_id, rating: order.rating, fulfillTx: order.fulfill_tx, purchaseTx: order.purchase_tx, amount: Number(order.amount_usdc) } : null,
        canRate: Boolean(isBuyer && order && !order.rating),
        isOwner: Boolean(isOwner),
      };
    }

    if (q.agentId) {
      if (!isUuid(q.agentId)) throw bad('Invalid agent id.');
      const agent = must(await db().from('agents').select('owner').eq('id', q.agentId).maybeSingle());
      if (!agent) throw notFound('Agent not found.');
      let sel = db().from('reports').select('id, ticker, title, origin, published, created_at, hash, content').eq('agent_id', q.agentId);
      if (wallet !== agent.owner) sel = sel.eq('published', true);
      const rows = must(await sel.order('created_at', { ascending: false }).limit(60));
      return { reports: rows.map(summary) };
    }

    if (q.recent) {
      const rows = must(await db().from('reports').select('id, ticker, title, origin, published, created_at, hash, content, agents(id, name, sector)').eq('published', true).order('created_at', { ascending: false }).limit(6));
      return { reports: rows.map(summary) };
    }

    throw bad('Pass ?id=, ?agentId= or ?recent=1.');
  },
});
