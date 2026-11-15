// GET  ?agentId=                         → real vault numbers + simulated paper portfolio (live quotes) + allocation history
// POST {action:'recommend', agentId}     → the agent evaluates its treasury against its policy and its research
// POST {action:'apply', allocationId}    → opens the recommended PAPER positions (never real trades)
import { route, readJson, query, bad, isUuid, notFound } from '../lib/http.js';
import { requireOwnedAgent } from '../lib/auth.js';
import { db, must } from '../lib/db.js';
import { readVault } from '../lib/chain.js';
import { quote } from '../lib/market-data.js';

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

async function portfolio(agentId) {
  const positions = must(await db().from('paper_positions').select('*').eq('agent_id', agentId).order('opened_at'));
  const tickers = [...new Set(positions.map((p) => p.ticker))];
  const quotes = Object.fromEntries(await Promise.all(tickers.map(async (t) => [t, await quote(t)])));
  let cost = 0;
  let value = 0;
  const rows = positions.map((p) => {
    const price = quotes[p.ticker]?.c ?? null;
    const v = price != null ? Number(p.shares) * price : Number(p.cost_basis);
    cost += Number(p.cost_basis);
    value += v;
    return { id: p.id, ticker: p.ticker, shares: Number(p.shares), costBasis: Number(p.cost_basis), price, value: round(v), pnl: round(v - Number(p.cost_basis)), openedAt: p.opened_at };
  });
  return { positions: rows, cost: round(cost), value: round(value), pnl: round(value - cost) };
}

export default route({
  GET: async (req) => {
    const { agentId } = query(req);
    if (!isUuid(agentId)) throw bad('Invalid agent id.');
    const agent = must(await db().from('agents').select('id, onchain_id, operating_budget').eq('id', agentId).maybeSingle());
    if (!agent) throw notFound('Agent not found.');
    const [vault, paper, allocations] = await Promise.all([
      agent.onchain_id ? readVault(agent.onchain_id).catch((e) => ({ error: e.message })) : null,
      portfolio(agent.id),
      db().from('allocations').select('*').eq('agent_id', agent.id).order('created_at', { ascending: false }).limit(20).then(must),
    ]);
    return {
      real: vault, // USDC actually held onchain
      simulated: paper, // paper portfolio — clearly separate
      operatingBudget: Number(agent.operating_budget),
      allocations: allocations.map((a) => ({ id: a.id, balance: Number(a.balance_usdc), reserve: Number(a.reserve), operating: Number(a.operating), simulated: Number(a.simulated), picks: a.picks, rationale: a.rationale, applied: a.applied, createdAt: a.created_at })),
    };
  },

  POST: async (req) => {
    const body = await readJson(req);

    if (body.action === 'recommend') {
      const { agent } = await requireOwnedAgent(req, body.agentId);
      if (!agent.onchain_id) throw bad('Register the agent onchain first.');
      const vault = await readVault(agent.onchain_id);
      const { reserve: rBps, operating: oBps, simulated: sBps } = vault.policy;
      const bal = vault.balance;
      const reserve = round((bal * rBps) / 1e4);
      const operating = round((bal * oBps) / 1e4);
      const simulatedTarget = round(bal - reserve - operating);
      const paper = await portfolio(agent.id);
      const available = Math.max(0, round(simulatedTarget - paper.cost));

      // Evidence: the agent's own latest report per ticker (last 30 days)
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const reps = must(await db().from('reports').select('id, ticker, content, created_at').eq('agent_id', agent.id).gte('created_at', since).order('created_at', { ascending: false }).limit(50));
      const latest = new Map();
      for (const r of reps) if (!latest.has(r.ticker)) latest.set(r.ticker, r);
      const candidates = [...latest.values()]
        .map((r) => ({ ticker: r.ticker, reportId: r.id, score: r.content?.analysis?.bull_score ?? 50 }))
        .filter((c) => c.score >= 55)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      let picks = [];
      let rationale;
      if (available < 1) {
        rationale = bal === 0
          ? 'No revenue yet. Sell a report to fund the treasury.'
          : `Simulated allocation is already at its ${sBps / 100}% target. Holding.`;
      } else if (!candidates.length) {
        rationale = `Research shows no ticker with a bullish score of 55+. Keeping the ${sBps / 100}% simulated sleeve in cash until conviction improves.`;
      } else {
        const weightSum = candidates.reduce((s, c) => s + (c.score - 50), 0);
        picks = await Promise.all(candidates.map(async (c) => {
          const weight = (c.score - 50) / weightSum;
          const amount = round(available * weight);
          const q = await quote(c.ticker);
          const price = q?.c ?? null;
          return { ticker: c.ticker, reportId: c.reportId, bullScore: c.score, weight: round(weight * 100, 1), amount, price, shares: price ? round(amount / price, 6) : null };
        }));
        picks = picks.filter((p) => p.price && p.shares > 0);
        rationale = `Policy ${rBps / 100}/${oBps / 100}/${sBps / 100}. ${available.toFixed(2)} USDC free for paper stocks, weighted by research conviction: ${picks.map((p) => `${p.ticker} ${p.weight}%`).join(', ')}.`;
      }

      const row = must(await db().from('allocations').insert({
        agent_id: agent.id, balance_usdc: bal, reserve, operating, simulated: simulatedTarget, picks, rationale,
      }).select().single());
      return { allocation: { id: row.id, balance: bal, reserve, operating, simulated: simulatedTarget, available, picks, rationale } };
    }

    if (body.action === 'apply') {
      if (!isUuid(body.allocationId)) throw bad('Invalid allocation id.');
      const a = must(await db().from('allocations').select('*').eq('id', body.allocationId).maybeSingle());
      if (!a) throw notFound('Allocation not found.');
      await requireOwnedAgent(req, a.agent_id);
      if (a.applied) throw bad('Already applied.');
      if (!a.picks?.length) throw bad('Nothing to apply — this recommendation holds cash.');
      if (Date.now() - Date.parse(a.created_at) > 30 * 60e3) throw bad('Recommendation is older than 30 minutes. Generate a fresh one.');
      must(await db().from('paper_positions').insert(a.picks.map((p) => ({ agent_id: a.agent_id, ticker: p.ticker, shares: p.shares, cost_basis: p.amount }))));
      must(await db().from('allocations').update({ applied: true }).eq('id', a.id));
      return { ok: true };
    }

    throw bad('Unknown action.');
  },
});
