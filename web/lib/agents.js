// Shared agent helpers used by several API routes.
import { db, must } from './db.js';

export const SECTORS = ['technology', 'ai', 'healthcare', 'energy', 'financials', 'general'];
export const STRATEGY_IDS = ['long_term', 'earnings', 'dividends', 'market_intel'];
export const FREQUENCIES = ['on_demand', 'daily', 'weekly'];

export const metadataUri = (kind, id) => `tickermind:${kind}:${id}`;

/** Public view of an agent (no internal fields). */
export function publicAgent(a, stats) {
  return {
    id: a.id,
    onchainId: a.onchain_id,
    owner: a.owner,
    name: a.name,
    description: a.description,
    sector: a.sector,
    strategy: a.strategy,
    frequency: a.frequency,
    focusTickers: a.focus_tickers,
    policy: { reserve: a.policy_reserve, operating: a.policy_operating, simulated: a.policy_simulated },
    operatingBudget: Number(a.operating_budget),
    permissions: a.permissions,
    status: a.status,
    createdAt: a.created_at,
    stats: stats
      ? {
          revenue: Number(stats.revenue || 0),
          completed: Number(stats.completed || 0),
          failed: Number(stats.failed || 0),
          pending: Number(stats.pending || 0),
          avgRating: stats.avg_rating != null ? Number(stats.avg_rating) : null,
          reports: Number(stats.report_count || 0),
        }
      : undefined,
  };
}

export async function statsFor(ids) {
  if (!ids.length) return new Map();
  const rows = must(await db().from('agent_stats').select('*').in('agent_id', ids));
  return new Map(rows.map((r) => [r.agent_id, r]));
}

export async function agentsWithStats(agents) {
  const stats = await statsFor(agents.map((a) => a.id));
  return agents.map((a) => publicAgent(a, stats.get(a.id)));
}
