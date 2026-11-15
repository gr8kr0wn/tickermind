// GET  ?id=<uuid>      → one agent + onchain treasury + services
// GET  ?mine=1         → the signed-in wallet's agents
// GET                  → all active agents
// POST {action:'create', ...config}        → draft agent + metadataURI to register onchain
// POST {action:'confirm', id, txHash}      → verifies AgentRegistered and activates the agent
// POST {action:'policy', id, txHash}       → verifies PolicySet and stores it
// POST {action:'update', id, ...fields}    → edits offchain config
import { route, readJson, query, bad, notFound, isUuid, isTxHash, cleanTicker } from '../lib/http.js';
import { requireSession, requireOwnedAgent, readSession } from '../lib/auth.js';
import { db, must } from '../lib/db.js';
import { eventsFromTx, readVault } from '../lib/chain.js';
import { SECTORS, STRATEGY_IDS, FREQUENCIES, metadataUri, publicAgent, agentsWithStats, statsFor } from '../lib/agents.js';

function validPolicy(p) {
  const r = Number(p?.reserve), o = Number(p?.operating), s = Number(p?.simulated);
  if (![r, o, s].every((x) => Number.isInteger(x) && x >= 0) || r + o + s !== 10000) throw bad('Policy must be whole basis points adding up to 10000.');
  return { policy_reserve: r, policy_operating: o, policy_simulated: s };
}

function configFields(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim().toUpperCase();
    if (name.length < 2 || name.length > 32) throw bad('Agent name must be 2–32 characters.');
    out.name = name;
  }
  if (body.description !== undefined) out.description = String(body.description).slice(0, 400);
  if (!partial || body.sector !== undefined) {
    if (!SECTORS.includes(body.sector)) throw bad('Pick a research focus.');
    out.sector = body.sector;
  }
  if (!partial || body.strategy !== undefined) {
    if (!STRATEGY_IDS.includes(body.strategy)) throw bad('Pick a strategy.');
    out.strategy = body.strategy;
  }
  if (!partial || body.frequency !== undefined) {
    if (!FREQUENCIES.includes(body.frequency)) throw bad('Pick a research frequency.');
    out.frequency = body.frequency;
  }
  if (body.focusTickers !== undefined) {
    const list = Array.isArray(body.focusTickers) ? body.focusTickers : String(body.focusTickers).split(/[\s,]+/);
    out.focus_tickers = [...new Set(list.filter(Boolean).map(cleanTicker))].slice(0, 10);
  }
  if (body.operatingBudget !== undefined) {
    const b = Number(body.operatingBudget);
    if (!Number.isFinite(b) || b < 0 || b > 1e6) throw bad('Operating budget must be between 0 and 1,000,000.');
    out.operating_budget = b;
  }
  if (body.policy !== undefined) Object.assign(out, validPolicy(body.policy));
  if (body.publishMode !== undefined) {
    out.permissions = {
      read_market: true, generate_research: true, receive_usdc: true, recommend_allocations: true,
      execute_transactions: false, // locked in the MVP
      publish_reports: body.publishMode === 'auto' ? 'auto' : 'approval',
    };
  }
  return out;
}

async function getOne(id, req) {
  if (!isUuid(id)) throw bad('Invalid agent id.');
  const a = must(await db().from('agents').select('*').eq('id', id).maybeSingle());
  if (!a || (a.status === 'draft' && readSession(req)?.wallet !== a.owner)) throw notFound('Agent not found.');
  const stats = (await statsFor([a.id])).get(a.id);
  const services = must(await db().from('services').select('*').eq('agent_id', a.id).not('onchain_service_id', 'is', null).order('created_at'));
  let treasury = null;
  if (a.onchain_id) {
    try { treasury = await readVault(a.onchain_id); } catch (e) { treasury = { error: e.message }; }
  }
  return {
    agent: publicAgent(a, stats),
    treasury,
    services: services.map((s) => ({ id: s.id, onchainId: s.onchain_service_id, title: s.title, description: s.description, defaultTicker: s.default_ticker, price: Number(s.price_usdc), active: s.active })),
    isOwner: readSession(req)?.wallet === a.owner,
  };
}

export default route({
  GET: async (req) => {
    const q = query(req);
    if (q.id) return getOne(q.id, req);
    if (q.mine) {
      const { wallet } = requireSession(req);
      const rows = must(await db().from('agents').select('*').eq('owner', wallet).neq('status', 'draft').order('created_at'));
      const list = await agentsWithStats(rows);
      // attach live balances (best effort)
      await Promise.all(list.map(async (a) => { try { a.treasury = await readVault(a.onchainId); } catch { a.treasury = null; } }));
      return { agents: list };
    }
    const rows = must(await db().from('agents').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(100));
    return { agents: await agentsWithStats(rows) };
  },

  POST: async (req) => {
    const body = await readJson(req);

    if (body.action === 'create') {
      const { wallet } = requireSession(req);
      const fields = configFields({ publishMode: 'approval', ...body });
      const row = must(await db().from('agents').insert({ ...fields, owner: wallet, status: 'draft' }).select().single());
      return { id: row.id, metadataURI: metadataUri('agent', row.id) };
    }

    if (body.action === 'confirm') {
      if (!isTxHash(body.txHash)) throw bad('txHash required.');
      const { wallet, agent } = await requireOwnedAgent(req, body.id);
      if (agent.onchain_id) return { id: agent.id, onchainId: agent.onchain_id };
      const logs = await eventsFromTx(body.txHash, 'registry', 'AgentRegistered');
      const ev = logs.find((l) => l.args.metadataURI === metadataUri('agent', agent.id));
      if (!ev) throw bad('That transaction registered a different agent.');
      if (ev.args.owner.toLowerCase() !== wallet) throw bad('Agent was registered by a different wallet.');
      const updated = must(await db().from('agents').update({ onchain_id: Number(ev.args.agentId), register_tx: body.txHash, status: 'active' }).eq('id', agent.id).select().single());
      return { id: updated.id, onchainId: updated.onchain_id };
    }

    if (body.action === 'policy') {
      if (!isTxHash(body.txHash)) throw bad('txHash required.');
      const { agent } = await requireOwnedAgent(req, body.id);
      const logs = await eventsFromTx(body.txHash, 'vault', 'PolicySet');
      const ev = logs.find((l) => Number(l.args.agentId) === Number(agent.onchain_id));
      if (!ev) throw bad('That transaction set a policy for a different agent.');
      const fields = { policy_reserve: Number(ev.args.reserveBps), policy_operating: Number(ev.args.operatingBps), policy_simulated: Number(ev.args.simulatedBps) };
      must(await db().from('agents').update(fields).eq('id', agent.id));
      return { policy: { reserve: fields.policy_reserve, operating: fields.policy_operating, simulated: fields.policy_simulated } };
    }

    if (body.action === 'update') {
      const { agent } = await requireOwnedAgent(req, body.id);
      const fields = configFields(body, true);
      delete fields.policy_reserve; delete fields.policy_operating; delete fields.policy_simulated; // onchain-only
      delete fields.name; // name is part of the identity
      const updated = must(await db().from('agents').update(fields).eq('id', agent.id).select().single());
      return { agent: publicAgent(updated) };
    }

    throw bad('Unknown action.');
  },
});
