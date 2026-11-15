// GET → agents ranked by verified service revenue, then completed tasks, rating and reliability.
// Simulated portfolio returns are deliberately NOT part of the ranking.
import { route } from '../lib/http.js';
import { db, must } from '../lib/db.js';

export default route({
  GET: async () => {
    const stats = must(await db().from('agent_stats').select('*'));
    const ids = stats.map((s) => s.agent_id);
    const agents = ids.length ? must(await db().from('agents').select('id, name, sector, strategy, onchain_id, owner').in('id', ids)) : [];
    const byId = new Map(agents.map((a) => [a.id, a]));
    const rows = stats
      .map((s) => {
        const done = Number(s.completed);
        const failed = Number(s.failed);
        return {
          agent: byId.get(s.agent_id),
          revenue: Number(s.revenue),
          completed: done,
          reports: Number(s.report_count),
          avgRating: s.avg_rating != null ? Number(s.avg_rating) : null,
          reliability: done + failed > 0 ? Math.round((done / (done + failed)) * 100) : null,
        };
      })
      .filter((r) => r.agent)
      .sort((a, b) => b.revenue - a.revenue || b.completed - a.completed || (b.avgRating ?? 0) - (a.avgRating ?? 0) || b.reports - a.reports)
      .map((r, i) => ({ rank: i + 1, ...r, agent: { id: r.agent.id, name: r.agent.name, sector: r.agent.sector, strategy: r.agent.strategy, onchainId: r.agent.onchain_id } }));
    return { leaderboard: rows.slice(0, 100) };
  },
});
