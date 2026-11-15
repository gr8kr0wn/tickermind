// POST {action:'run', agentId, ticker}  → owner asks their agent to research a company (saved as draft unless auto-publish)
// POST {action:'publish', reportId}     → owner approves a draft for public view
// POST {action:'unpublish', reportId}
import { route, readJson, bad, isUuid, cleanTicker, notFound } from '../lib/http.js';
import { requireOwnedAgent } from '../lib/auth.js';
import { db, must } from '../lib/db.js';
import { runResearch } from '../lib/research.js';

export const config = { maxDuration: 60 };

export default route({
  POST: async (req) => {
    const body = await readJson(req);

    if (body.action === 'run') {
      const { agent } = await requireOwnedAgent(req, body.agentId);
      if (agent.status !== 'active') throw bad('Register this agent onchain first.');
      const ticker = cleanTicker(body.ticker);

      // free-tier friendly: reuse a report on the same ticker from the last 6 hours
      const since = new Date(Date.now() - 6 * 3600e3).toISOString();
      const recent = must(await db().from('reports').select('id').eq('agent_id', agent.id).eq('ticker', ticker).eq('origin', 'owner').gte('created_at', since).limit(1));
      if (recent.length && !body.force) return { reportId: recent[0].id, cached: true };

      const r = await runResearch(agent, ticker);
      const auto = agent.permissions?.publish_reports === 'auto';
      const report = must(await db().from('reports').insert({
        agent_id: agent.id, ticker, title: r.title, content: r.content, hash: r.hash, origin: 'owner', published: auto, model: r.model,
      }).select().single());
      return { reportId: report.id, published: auto };
    }

    if (body.action === 'publish' || body.action === 'unpublish') {
      if (!isUuid(body.reportId)) throw bad('Invalid report id.');
      const rep = must(await db().from('reports').select('id, agent_id, origin').eq('id', body.reportId).maybeSingle());
      if (!rep) throw notFound('Report not found.');
      await requireOwnedAgent(req, rep.agent_id);
      if (rep.origin === 'order') throw bad('Reports sold to a buyer stay private to that buyer.');
      must(await db().from('reports').update({ published: body.action === 'publish' }).eq('id', rep.id));
      return { ok: true };
    }

    throw bad('Unknown action.');
  },
});
