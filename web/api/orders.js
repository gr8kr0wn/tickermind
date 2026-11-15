// POST {action:'confirm', txHash, ticker} → verifies the purchase onchain, runs the seller agent's research,
//      checks quality, then the operator releases escrow (fulfill) or refunds.
// POST {action:'rate', id, rating}         → buyer rates a delivered report (1–5)
// GET  ?mine=1                             → purchases by the signed-in wallet (and its agents)
// GET  ?agentId=<uuid>                     → an agent's sales activity (public summary)
import { route, readJson, query, bad, isTxHash, isUuid, cleanTicker, forbidden, notFound } from '../lib/http.js';
import { requireSession } from '../lib/auth.js';
import { db, must } from '../lib/db.js';
import { eventsFromTx, toUsdc, operatorFulfill, operatorRefund } from '../lib/chain.js';
import { runResearch, passesQualityGate } from '../lib/research.js';

export const config = { maxDuration: 60 };

async function confirmOrder(req, body) {
  const { wallet } = requireSession(req);
  if (!isTxHash(body.txHash)) throw bad('txHash required.');
  const ticker = cleanTicker(body.ticker);

  // Idempotent: if we already processed this tx, return it.
  const existing = must(await db().from('orders').select('*').eq('purchase_tx', body.txHash).maybeSingle());
  if (existing) return { order: existing };

  const [ev] = await eventsFromTx(body.txHash, 'marketplace', 'OrderCreated');
  const a = ev.args;
  if (a.buyer.toLowerCase() !== wallet) throw forbidden('This purchase was made by a different wallet.');

  const service = must(await db().from('services').select('*, agents!inner(*)').eq('onchain_service_id', Number(a.serviceId)).maybeSingle());
  if (!service) throw bad('Service not found in TickerMind.');
  const seller = service.agents;

  let buyerAgentId = null;
  if (Number(a.buyerAgentId) > 0) {
    const ba = must(await db().from('agents').select('id').eq('onchain_id', Number(a.buyerAgentId)).maybeSingle());
    buyerAgentId = ba?.id || null;
  }

  const inserted = await db().from('orders').insert({
    onchain_order_id: Number(a.orderId), service_id: service.id, seller_agent_id: seller.id,
    buyer_wallet: wallet, buyer_agent_id: buyerAgentId, ticker, amount_usdc: toUsdc(a.amount),
    purchase_tx: body.txHash, status: 'pending',
  }).select().single();
  if (inserted.error) {
    // a parallel request inserted it first
    const again = must(await db().from('orders').select('*').eq('purchase_tx', body.txHash).maybeSingle());
    if (again) return { order: again };
    throw new Error(inserted.error.message);
  }
  const order = inserted.data;

  try {
    const r = await runResearch(seller, ticker);
    if (!passesQualityGate(r.content)) throw new Error('Report failed the quality check (not enough sourced facts).');
    const report = must(await db().from('reports').insert({
      agent_id: seller.id, ticker, title: r.title, content: r.content, hash: r.hash, origin: 'order', published: false, model: r.model,
    }).select().single());
    const fulfillTx = await operatorFulfill(order.onchain_order_id, r.hash);
    const done = must(await db().from('orders').update({
      status: 'fulfilled', report_id: report.id, fulfill_tx: fulfillTx, fulfilled_at: new Date().toISOString(),
    }).eq('id', order.id).select().single());
    return { order: done, reportId: report.id };
  } catch (err) {
    console.error('order failed', err);
    let refundTx = null;
    try { refundTx = await operatorRefund(order.onchain_order_id); } catch (e) { console.error('refund failed', e); }
    const failed = must(await db().from('orders').update({
      status: refundTx ? 'refunded' : 'failed', fulfill_tx: refundTx, error: String(err.message || err).slice(0, 300),
    }).eq('id', order.id).select().single());
    return { order: failed, error: refundTx ? `${err.message} Your USDC was refunded.` : `${err.message} Refund pending — you can self-refund after 24h.` };
  }
}

function shape(o) {
  return {
    id: o.id, onchainOrderId: o.onchain_order_id, ticker: o.ticker, amount: Number(o.amount_usdc), status: o.status,
    reportId: o.report_id, rating: o.rating, createdAt: o.created_at, fulfilledAt: o.fulfilled_at,
    purchaseTx: o.purchase_tx, fulfillTx: o.fulfill_tx, error: o.error,
    service: o.services ? { id: o.services.id, title: o.services.title } : undefined,
    seller: o.seller ? { id: o.seller.id, name: o.seller.name } : undefined,
    buyerAgent: o.buyer ? { id: o.buyer.id, name: o.buyer.name } : null,
  };
}

const SELECT = '*, services(id, title), seller:agents!orders_seller_agent_id_fkey(id, name), buyer:agents!orders_buyer_agent_id_fkey(id, name)';

export default route({
  POST: async (req) => {
    const body = await readJson(req);
    if (body.action === 'confirm') {
      const r = await confirmOrder(req, body);
      return { ...r, order: shape(r.order) };
    }
    if (body.action === 'rate') {
      const { wallet } = requireSession(req);
      const rating = Number(body.rating);
      if (!isUuid(body.id) || !Number.isInteger(rating) || rating < 1 || rating > 5) throw bad('Rating must be 1–5.');
      const o = must(await db().from('orders').select('*').eq('id', body.id).maybeSingle());
      if (!o) throw notFound('Order not found.');
      if (o.buyer_wallet !== wallet) throw forbidden('Only the buyer can rate this report.');
      if (o.status !== 'fulfilled') throw bad('You can rate once the report is delivered.');
      must(await db().from('orders').update({ rating }).eq('id', o.id));
      return { ok: true };
    }
    throw bad('Unknown action.');
  },

  GET: async (req) => {
    const q = query(req);
    if (q.mine) {
      const { wallet } = requireSession(req);
      const rows = must(await db().from('orders').select(SELECT).eq('buyer_wallet', wallet).order('created_at', { ascending: false }).limit(100));
      return { orders: rows.map(shape) };
    }
    if (q.agentId) {
      if (!isUuid(q.agentId)) throw bad('Invalid agent id.');
      const sold = must(await db().from('orders').select(SELECT).eq('seller_agent_id', q.agentId).order('created_at', { ascending: false }).limit(50));
      const bought = must(await db().from('orders').select(SELECT).eq('buyer_agent_id', q.agentId).order('created_at', { ascending: false }).limit(50));
      const strip = (o) => ({ ...shape(o), error: undefined, reportId: undefined });
      return { sold: sold.map(strip), bought: bought.map(strip) };
    }
    throw bad('Pass ?mine=1 or ?agentId=.');
  },
});
