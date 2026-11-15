// GET → landing page numbers: agents deployed, verified revenue, reports, featured agents.
import { route } from '../lib/http.js';
import { db, must } from '../lib/db.js';

export default route({
  GET: async () => {
    const [{ count: agents }, { count: reports }, stats] = await Promise.all([
      db().from('agents').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      db().from('reports').select('id', { count: 'exact', head: true }),
      db().from('agent_stats').select('*').then(must),
    ]);
    const revenue = stats.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const completed = stats.reduce((s, r) => s + Number(r.completed || 0), 0);
    const top = [...stats].sort((a, b) => Number(b.revenue) - Number(a.revenue) || Number(b.report_count) - Number(a.report_count)).slice(0, 8);
    const ids = top.map((t) => t.agent_id);
    const rows = ids.length ? must(await db().from('agents').select('id, name, sector, onchain_id').in('id', ids)) : [];
    const byId = new Map(rows.map((a) => [a.id, a]));
    return {
      agents: agents || 0,
      reports: reports || 0,
      revenue,
      completed,
      featured: top.filter((t) => byId.get(t.agent_id)).map((t) => ({ ...byId.get(t.agent_id), revenue: Number(t.revenue), completed: Number(t.completed) })),
    };
  },
});
