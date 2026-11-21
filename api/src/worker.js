// Background worker: claims pending tasks one at a time (no HTTP request is held open),
// runs the research pipeline, saves the report, settles any order, and schedules recurring research.
const db = require('./db');
const cfg = require('./config');
const research = require('./research');
const ledger = require('./ledger');
const economy = require('./economy');

let running = false;
let timer = null;

async function processTask(task) {
  const agent = await db.get('agents', task.agent_id);
  let report = null;
  let ok = false;
  try {
    if (!agent) throw new Error('Agent no longer exists');
    const p = agent.config.permissions;
    if (!p.generateReports) throw new Error('Agent is not permitted to generate reports');
    if (!p.readMarketData) throw new Error('Agent is not permitted to read market data');
    await db.update('agents', agent.id, { status: 'processing' });
    const res = await research.run(task);
    report = await db.insert('reports', {
      agent_id: agent.id,
      task_id: task.id,
      company: res.company.name,
      ticker: res.company.ticker,
      report_data: res.report,
      sources: res.sources,
      status: p.publishReports ? 'published' : 'draft',
      quality_score: res.quality,
    });
    await db.update('tasks', task.id, { status: 'completed', completed_at: new Date().toISOString(), report_id: report.id });
    ok = true;
    await ledger.expense(agent.id, economy.COMPUTE_COST, 'compute:' + task.id).catch(() => {});
  } catch (e) {
    console.warn('[worker] task failed:', task.id, e.message);
    await db.update('tasks', task.id, { status: 'failed', error: String(e.message).slice(0, 300), completed_at: new Date().toISOString() });
  } finally {
    const fresh = agent && (await db.get('agents', agent.id));
    if (fresh && fresh.status === 'processing') await db.update('agents', agent.id, { status: 'active' });
  }
  try {
    await economy.settle(task, agent, report, ok);
  } catch (e) {
    console.error('[worker] settlement error:', task.id, e.message);
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) {
      if (Date.now() - t0 > 100_000) break; // stay inside the edge function time limit
      const task = await db.claimTask();
      if (!task) break;
      await processTask(task);
    }
  } catch (e) {
    console.error('[worker] tick error:', e.message);
  } finally {
    running = false;
  }
}

// recurring research for agents configured daily / weekly
async function schedule() {
  const agents = await db.list('agents', { limit: 500 });
  const now = Date.now();
  for (const a of agents) {
    const f = a.config.researchFrequency;
    if (a.status !== 'active' || !['daily', 'weekly'].includes(f) || !a.config.permissions.generateReports) continue;
    const every = f === 'daily' ? 86400_000 : 7 * 86400_000;
    const tasks = await db.list('tasks', { where: { agent_id: a.id }, limit: 300 });
    for (const target of (a.config.researchTargets || []).slice(0, 3)) {
      const last = tasks.filter((t) => t.target === target && !t.order_id).map((t) => new Date(t.created_at).getTime()).sort().pop() || 0;
      if (now - last < every) continue;
      const type = /^[A-Z]{1,5}$/.test(target) ? 'company_research' : 'industry_analysis';
      try {
        await economy.enqueue({ agent: a, taskType: type, target, requestedBy: 'scheduler' });
      } catch (_) {}
    }
  }
}

// serverless: no timers, so schedule at most every 30 min per instance (it is idempotent by task age)
let lastSchedule = 0;
async function maybeSchedule() {
  if (!cfg.schedulerEnabled || Date.now() - lastSchedule < 30 * 60_000) return;
  lastSchedule = Date.now();
  await schedule().catch((e) => console.warn('[scheduler]', e.message));
}

function start() {
  timer = setInterval(tick, cfg.workerIntervalMs);
  if (cfg.schedulerEnabled) {
    setInterval(() => schedule().catch((e) => console.warn('[scheduler]', e.message)), 30 * 60_000);
    setTimeout(() => schedule().catch(() => {}), 20_000);
  }
}
const stop = () => clearInterval(timer);

module.exports = { start, stop, tick, processTask, maybeSchedule };
