// GET  [?agentId=] [?sector=]                 → marketplace listings
// POST {action:'create', agentId, title, description, defaultTicker, price} → draft + metadataURI
// POST {action:'confirm', id, txHash}         → verifies ServiceCreated
// POST {action:'update', id, txHash}          → verifies ServiceUpdated (price / active)
import { route, readJson, query, bad, isTxHash, isUuid, cleanTicker } from '../lib/http.js';
import { requireOwnedAgent, requireSession } from '../lib/auth.js';
import { db, must } from '../lib/db.js';
import { eventsFromTx, toUsdc } from '../lib/chain.js';
import { metadataUri, statsFor } from '../lib/agents.js';

async function ownedService(req, id) {
  if (!isUuid(id)) throw bad('Invalid service id.');
  const s = must(await db().from('services').select('*').eq('id', id).maybeSingle());
  if (!s) throw bad('Service not found.');
  const { agent } = await requireOwnedAgent(req, s.agent_id);
  return { service: s, agent };
}

export default route({
  GET: async (req) => {
    const q = query(req);
    let sel = db().from('services').select('*, agents!inner(id, name, sector, strategy, onchain_id, owner, status)')
      .not('onchain_service_id', 'is', null).eq('active', true).eq('agents.status', 'active');
    if (q.agentId) sel = sel.eq('agent_id', q.agentId);
    if (q.sector && q.sector !== 'all') sel = sel.eq('agents.sector', q.sector);
    const rows = must(await sel.order('created_at', { ascending: false }).limit(200));
    const stats = await statsFor([...new Set(rows.map((r) => r.agent_id))]);
    return {
      services: rows.map((s) => {
        const st = stats.get(s.agent_id) || {};
        return {
          id: s.id, onchainId: s.onchain_service_id, title: s.title, description: s.description,
          defaultTicker: s.default_ticker, price: Number(s.price_usdc),
          agent: { id: s.agents.id, name: s.agents.name, sector: s.agents.sector, strategy: s.agents.strategy, onchainId: s.agents.onchain_id, owner: s.agents.owner },
          stats: { completed: Number(st.completed || 0), avgRating: st.avg_rating != null ? Number(st.avg_rating) : null, revenue: Number(st.revenue || 0) },
        };
      }),
    };
  },

  POST: async (req) => {
    const body = await readJson(req);

    if (body.action === 'create') {
      requireSession(req);
      const { agent } = await requireOwnedAgent(req, body.agentId);
      if (!agent.onchain_id) throw bad('Register the agent onchain before listing services.');
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0.01 || price > 10000) throw bad('Price must be between 0.01 and 10,000 USDC.');
      const title = String(body.title || '').trim();
      if (title.length < 3) throw bad('Give the service a title.');
      const row = must(await db().from('services').insert({
        agent_id: agent.id, title: title.slice(0, 80), description: String(body.description || '').slice(0, 300),
        default_ticker: body.defaultTicker ? cleanTicker(body.defaultTicker) : null, price_usdc: Math.round(price * 1e6) / 1e6,
      }).select().single());
      return { id: row.id, metadataURI: metadataUri('service', row.id), priceRaw: String(Math.round(price * 1e6)), agentOnchainId: agent.onchain_id };
    }

    if (body.action === 'confirm') {
      if (!isTxHash(body.txHash)) throw bad('txHash required.');
      const { service, agent } = await ownedService(req, body.id);
      if (service.onchain_service_id) return { id: service.id, onchainId: service.onchain_service_id };
      const logs = await eventsFromTx(body.txHash, 'marketplace', 'ServiceCreated');
      const ev = logs.find((l) => l.args.metadataURI === metadataUri('service', service.id));
      if (!ev) throw bad('That transaction created a different service.');
      if (Number(ev.args.agentId) !== Number(agent.onchain_id)) throw bad('Service belongs to a different agent onchain.');
      const updated = must(await db().from('services').update({
        onchain_service_id: Number(ev.args.serviceId), price_usdc: toUsdc(ev.args.price), create_tx: body.txHash,
      }).eq('id', service.id).select().single());
      return { id: updated.id, onchainId: updated.onchain_service_id };
    }

    if (body.action === 'update') {
      if (!isTxHash(body.txHash)) throw bad('txHash required.');
      const { service } = await ownedService(req, body.id);
      const logs = await eventsFromTx(body.txHash, 'marketplace', 'ServiceUpdated');
      const ev = logs.find((l) => Number(l.args.serviceId) === Number(service.onchain_service_id));
      if (!ev) throw bad('That transaction updated a different service.');
      must(await db().from('services').update({ price_usdc: toUsdc(ev.args.price), active: ev.args.active }).eq('id', service.id));
      return { ok: true };
    }

    throw bad('Unknown action.');
  },
});
