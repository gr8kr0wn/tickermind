const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const cfg = require('./config');
const auth = require('./auth');
const ledger = require('./ledger');
const portfolio = require('./portfolio');
const economy = require('./economy');
const chain = require('./chain');
const seedMod = require('./seed');
const { fromDb, parseUnits } = require('./money');
const { wrap, bad, forbidden, notFound, conflict, withLock } = require('./util');
const { validateAgentConfig, validateService, validateTarget } = require('./validators');

const r = express.Router();
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
r.param('id', (_q, _s, next, v) => (isUuid(v) ? next() : next(notFound())));

r.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 60_000, limit: 30 });
const demoLimiter = rateLimit({ windowMs: 3600_000, limit: 6, message: { error: 'Demo limit reached, try again in an hour' } });
r.use(auth.optionalAuth);

// ---------- helpers ----------
async function statsMap() {
  const [tasks, reports, orders] = await Promise.all([
    db.list('tasks', { limit: 20000 }), db.list('reports', { limit: 20000 }), db.list('orders', { limit: 20000 }),
  ]);
  const m = new Map();
  const g = (id) => m.get(id) || m.set(id, { reports: 0, completedTasks: 0, failedTasks: 0, qualitySum: 0, revenue: 0n, orders: 0, recentTasks: 0 }).get(id);
  const week = Date.now() - 7 * 86400_000;
  for (const t of tasks) {
    const s = g(t.agent_id);
    if (t.status === 'completed') s.completedTasks++;
    if (t.status === 'failed') s.failedTasks++;
    if (new Date(t.created_at).getTime() > week) s.recentTasks++;
  }
  for (const x of reports) if (x.status === 'published') { const s = g(x.agent_id); s.reports++; s.qualitySum += x.quality_score || 0; }
  for (const o of orders) if (o.status === 'completed') { const s = g(o.agent_id); s.revenue += fromDb(o.amount); s.orders++; }
  return m;
}
const emptyStats = { reports: 0, completedTasks: 0, failedTasks: 0, qualitySum: 0, revenue: 0n, orders: 0, recentTasks: 0 };
const statView = (s = emptyStats) => ({
  reports: s.reports, completedTasks: s.completedTasks, failedTasks: s.failedTasks, orders: s.orders,
  revenue: s.revenue.toString(), quality: s.reports ? Math.round(s.qualitySum / s.reports) : null, recentTasks: s.recentTasks,
});
const agentView = (a, st) => ({
  id: a.id, name: a.name, description: a.description, specialization: a.specialization, avatar: Number(a.avatar || 0),
  status: a.status, onchainAgentId: a.onchain_agent_id, owner: a.owner_wallet, demo: !!a.config.demo, createdAt: a.created_at,
  config: { researchTargets: a.config.researchTargets, researchFrequency: a.config.researchFrequency, permissions: a.config.permissions, allocationPolicy: a.config.allocationPolicy },
  stats: statView(st),
});
const mini = (a) => ({ id: a.id, name: a.name, avatar: Number(a.avatar || 0), specialization: a.specialization, status: a.status, demo: !!a.config.demo });
const serviceView = (s, a) => ({ id: s.id, agentId: s.agent_id, title: s.title, description: s.description, category: s.category, price: String(s.price), currency: s.currency, estMinutes: s.est_minutes, isActive: s.is_active, agent: a ? mini(a) : undefined });

async function loadAgent(id) {
  const a = await db.get('agents', id);
  if (!a) throw notFound('Agent not found');
  return a;
}
async function ownAgent(req, id) {
  if (!req.wallet) throw new (require('./util').HttpError)(401, 'Sign in with your wallet');
  const a = await loadAgent(id);
  if (a.owner_wallet.toLowerCase() !== req.wallet) throw forbidden('You do not own this agent');
  return a;
}
const requireAuth = auth.requireAuth;

// ---------- public config / stats ----------
r.get('/health', (_q, s) => s.json({ ok: true, db: db.kind, llm: require('./llm').enabled(), chain: cfg.chainEnabled, demoMode: cfg.demoMode }));
r.get('/config', (_q, s) =>
  s.json({
    chainId: cfg.chainId, rpcUrl: cfg.rpcUrl, usdc: cfg.usdc, registry: cfg.registry || null, marketplace: cfg.marketplace || null,
    chainEnabled: cfg.chainEnabled, demoMode: cfg.demoMode, explorer: 'https://sepolia.basescan.org', db: db.kind,
  })
);

r.get('/stats', wrap(async (_q, s) => {
  const [agents, reports, orders, a2a, tasks] = await Promise.all([db.list('agents'), db.list('reports'), db.list('orders'), db.list('a2a_requests'), db.list('tasks')]);
  const done = orders.filter((o) => o.status === 'completed');
  s.json({
    agents: agents.length, reports: reports.filter((x) => x.status === 'published').length, tasks: tasks.filter((t) => t.status === 'completed').length,
    orders: done.length, volume: done.reduce((a, o) => a + fromDb(o.amount), 0n).toString(), a2a: a2a.filter((x) => x.status === 'completed').length,
  });
}));

// ---------- auth ----------
r.get('/auth/nonce', (_q, s) => { const nonce = auth.makeNonce(); s.json({ nonce, message: auth.messageFor(nonce) }); });
r.post('/auth/verify', authLimiter, wrap(async (q, s) => {
  const { address, signature, nonce } = q.body || {};
  s.json(auth.verifyLogin(address, signature, nonce));
}));

// ---------- agents ----------
r.get('/agents', wrap(async (q, s) => {
  const [agents, st] = await Promise.all([db.list('agents', { limit: 500 }), statsMap()]);
  const search = String(q.query.q || '').toLowerCase();
  let out = agents.filter((a) => a.status !== 'archived' && (!q.query.spec || a.specialization === q.query.spec) && (!search || (a.name + ' ' + a.description).toLowerCase().includes(search)));
  const view = out.map((a) => agentView(a, st.get(a.id)));
  const sorts = {
    revenue: (x, y) => (BigInt(y.stats.revenue) > BigInt(x.stats.revenue) ? 1 : -1),
    reports: (x, y) => y.stats.reports - x.stats.reports,
    quality: (x, y) => (y.stats.quality || 0) - (x.stats.quality || 0),
    recent: (x, y) => (x.createdAt < y.createdAt ? 1 : -1),
  };
  view.sort(sorts[q.query.sort] || sorts.recent);
  s.json(view);
}));

r.post('/agents', requireAuth, wrap(async (q, s) => {
  const { fields, config } = validateAgentConfig(q.body || {});
  const mine = await db.list('agents', { where: { owner_wallet: q.wallet } });
  if (mine.filter((a) => a.status !== 'archived').length >= 5) throw bad('Limit of 5 agents per wallet in the sandbox');
  let onchainId = null;
  const registerTx = q.body.registerTx;
  if (cfg.chainEnabled && registerTx) {
    onchainId = await chain.verifyRegistration(registerTx, q.wallet);
    if ((await db.list('agents', { where: { onchain_agent_id: onchainId } })).length) throw conflict('That onchain agent is already linked');
  } else if (cfg.chainEnabled && !cfg.demoMode) throw bad('Register your agent onchain first');
  const agent = await db.insert('agents', { owner_wallet: q.wallet, onchain_agent_id: onchainId, register_tx: registerTx || null, ...fields, status: 'active', config });
  await ledger.faucet(agent.id, parseUnits('100')); // SIMULATED starter grant so agents can buy from each other
  s.status(201).json(agentView(agent));
}));

r.get('/agents/:id', wrap(async (q, s) => {
  const a = await loadAgent(q.params.id);
  const [st, services, reports, tasks] = await Promise.all([
    statsMap(), db.list('services', { where: { agent_id: a.id } }),
    db.list('reports', { where: { agent_id: a.id }, limit: 12 }), db.list('tasks', { where: { agent_id: a.id }, limit: 10 }),
  ]);
  const own = q.wallet && q.wallet === a.owner_wallet.toLowerCase();
  s.json({
    ...agentView(a, st.get(a.id)), isOwner: !!own,
    services: services.map((x) => serviceView(x)),
    reports: reports.filter((x) => x.status === 'published' || own).map((x) => reportSummary(x, a)),
    tasks: tasks.map((t) => ({ id: t.id, type: t.task_type, target: t.target, status: t.status, error: t.error, createdAt: t.created_at, reportId: t.report_id })),
  });
}));

r.patch('/agents/:id', requireAuth, wrap(async (q, s) => {
  const a = await ownAgent(q, q.params.id);
  const patch = {};
  if (q.body.status !== undefined) {
    if (!['active', 'paused', 'archived'].includes(q.body.status)) throw bad('Bad status');
    patch.status = q.body.status;
  }
  const hasCfg = ['name', 'description', 'specialization', 'avatar', 'researchTargets', 'researchFrequency', 'permissions', 'allocationPolicy'].some((k) => q.body[k] !== undefined);
  if (hasCfg) {
    const { fields, config } = validateAgentConfig(q.body, { partial: true });
    Object.assign(patch, fields);
    patch.config = { ...a.config, ...config };
  }
  const updated = await db.update('agents', a.id, patch);
  s.json(agentView(updated));
}));

// ---------- services / marketplace ----------
r.post('/agents/:id/services', requireAuth, wrap(async (q, s) => {
  const a = await ownAgent(q, q.params.id);
  const v = validateService(q.body || {});
  const svc = await db.insert('services', { agent_id: a.id, ...v, price: Number(v.price), currency: 'USDC', is_active: true });
  s.status(201).json(serviceView(svc, a));
}));
r.patch('/services/:id', requireAuth, wrap(async (q, s) => {
  const svc = await db.get('services', q.params.id);
  if (!svc) throw notFound();
  await ownAgent(q, svc.agent_id);
  s.json(serviceView(await db.update('services', svc.id, { is_active: !!q.body.isActive })));
}));
r.get('/services', wrap(async (q, s) => {
  const [svcs, agents, st] = await Promise.all([db.list('services', { limit: 1000 }), db.list('agents', { limit: 1000 }), statsMap()]);
  const am = new Map(agents.map((a) => [a.id, a]));
  const search = String(q.query.q || '').toLowerCase();
  const out = svcs
    .filter((x) => x.is_active && am.get(x.agent_id)?.status === 'active' && (!q.query.category || x.category === q.query.category) && (!search || (x.title + ' ' + x.description + ' ' + am.get(x.agent_id).name).toLowerCase().includes(search)))
    .map((x) => ({ ...serviceView(x, am.get(x.agent_id)), agentStats: statView(st.get(x.agent_id)) }));
  s.json(out);
}));

// ---------- tasks & reports ----------
r.post('/agents/:id/tasks', requireAuth, wrap(async (q, s) => {
  const a = await ownAgent(q, q.params.id);
  const target = validateTarget(q.body.taskType, q.body.target);
  const t = await economy.enqueue({ agent: a, taskType: q.body.taskType, target, requestedBy: q.wallet });
  s.status(202).json({ id: t.id, status: t.status });
}));
r.get('/tasks/:id', wrap(async (q, s) => {
  const t = await db.get('tasks', q.params.id);
  if (!t) throw notFound();
  s.json({ id: t.id, agentId: t.agent_id, type: t.task_type, target: t.target, status: t.status, error: t.error, reportId: t.report_id, createdAt: t.created_at, completedAt: t.completed_at });
}));

const reportSummary = (x, a) => ({
  id: x.id, agentId: x.agent_id, agentName: a?.name, agentAvatar: a ? Number(a.avatar || 0) : 0, company: x.company, ticker: x.ticker,
  quality: x.quality_score, status: x.status, createdAt: x.created_at, taskType: x.report_data?.taskType,
  overview: String(x.report_data?.overview || '').slice(0, 200), generator: x.report_data?.interpretation?.generator,
});
r.get('/reports', wrap(async (q, s) => {
  const where = isUuid(q.query.agentId) ? { agent_id: q.query.agentId } : {};
  const [rows, agents] = await Promise.all([db.list('reports', { where, limit: 60 }), db.list('agents', { limit: 1000 })]);
  const am = new Map(agents.map((a) => [a.id, a]));
  s.json(rows.filter((x) => x.status === 'published').slice(0, 40).map((x) => reportSummary(x, am.get(x.agent_id))));
}));
r.get('/reports/:id', wrap(async (q, s) => {
  const x = await db.get('reports', q.params.id);
  if (!x) throw notFound('Report not found');
  const a = await db.get('agents', x.agent_id);
  if (x.status !== 'published' && !(q.wallet && a && a.owner_wallet.toLowerCase() === q.wallet)) throw notFound('Report not found');
  s.json({ ...reportSummary(x, a), report: x.report_data, sources: x.sources });
}));

// ---------- orders (human buyers) ----------
const orderView = (o, svc, a) => ({
  id: o.id, buyer: o.buyer, serviceId: o.service_id, serviceTitle: svc?.title, agentId: o.agent_id, agentName: a?.name, agentAvatar: a ? Number(a.avatar || 0) : 0,
  target: o.target, amount: String(o.amount), txHash: o.tx_hash, status: o.status, kind: o.kind, reportId: o.report_id, createdAt: o.created_at,
});
async function orderCtx(o) {
  const [svc, a] = await Promise.all([db.get('services', o.service_id), db.get('agents', o.agent_id)]);
  return orderView(o, svc, a);
}

r.post('/orders', requireAuth, wrap(async (q, s) => {
  const svc = await db.get('services', q.body.serviceId || '');
  if (!svc || !svc.is_active) throw notFound('Service not available');
  const agent = await loadAgent(svc.agent_id);
  if (agent.status !== 'active' || !agent.config.permissions.acceptTasks) throw conflict('This agent is not accepting tasks right now');
  const taskType = require('./validators').serviceCatToTask[svc.category];
  const target = validateTarget(taskType, q.body.target);
  const order = await db.insert('orders', { buyer: q.wallet, service_id: svc.id, agent_id: agent.id, target, amount: svc.price, tx_hash: null, status: 'pending_payment', kind: 'human', report_id: null });
  s.status(201).json({
    order: await orderCtx(order),
    payment: {
      orderIdBytes32: chain.orderIdBytes32(order.id), amount: String(order.amount), agentOnchainId: agent.onchain_agent_id,
      marketplace: cfg.marketplace || null, usdc: cfg.usdc, canPayOnchain: !!(cfg.chainEnabled && agent.onchain_agent_id !== null && agent.onchain_agent_id !== undefined), demoMode: cfg.demoMode,
    },
  });
}));

async function ownOrder(q, id) {
  const o = await db.get('orders', id);
  if (!o) throw notFound('Order not found');
  if (o.buyer !== q.wallet) throw forbidden('This is not your order');
  return o;
}
r.post('/orders/:id/confirm', requireAuth, wrap(async (q, s) => {
  await withLock('order:' + q.params.id, async () => {
    const o = await ownOrder(q, q.params.id);
    if (o.status !== 'pending_payment') throw conflict('Order is not waiting for payment');
    if (!cfg.chainEnabled) throw bad('Onchain payments are not configured on this server');
    const [agent, svc] = await Promise.all([loadAgent(o.agent_id), db.get('services', o.service_id)]);
    const txHash = String(q.body.txHash || '').toLowerCase();
    if ((await db.list('orders', { where: { tx_hash: txHash } })).length) throw conflict('That transaction was already used');
    await chain.verifyPayment({ txHash, order: o, agent, buyer: q.wallet });
    await db.update('orders', o.id, { tx_hash: txHash, status: 'paid' });
    await economy.startPaidOrder({ ...o, tx_hash: txHash }, agent, svc);
  });
  s.json(await orderCtx(await db.get('orders', q.params.id)));
}));
r.post('/orders/:id/demo-pay', requireAuth, wrap(async (q, s) => {
  if (!cfg.demoMode) throw forbidden('Simulated payments are disabled');
  await withLock('order:' + q.params.id, async () => {
    const o = await ownOrder(q, q.params.id);
    if (o.status !== 'pending_payment') throw conflict('Order is not waiting for payment');
    const [agent, svc] = await Promise.all([loadAgent(o.agent_id), db.get('services', o.service_id)]);
    await db.update('orders', o.id, { status: 'paid', kind: 'demo' });
    await economy.startPaidOrder(o, agent, svc);
  });
  s.json(await orderCtx(await db.get('orders', q.params.id)));
}));
r.get('/orders/:id', requireAuth, wrap(async (q, s) => {
  const o = await db.get('orders', q.params.id);
  if (!o) throw notFound();
  const a = await db.get('agents', o.agent_id);
  if (o.buyer !== q.wallet && a.owner_wallet.toLowerCase() !== q.wallet) throw forbidden();
  s.json(await orderCtx(o));
}));
r.get('/orders', requireAuth, wrap(async (q, s) => {
  const mine = await db.list('agents', { where: { owner_wallet: q.wallet } });
  const ids = new Set(mine.map((a) => a.id));
  const all = await db.list('orders', { limit: 2000 });
  const role = q.query.role === 'seller' ? 'seller' : 'buyer';
  const rows = all.filter((o) => (role === 'buyer' ? o.buyer === q.wallet : ids.has(o.agent_id))).slice(0, 50);
  s.json(await Promise.all(rows.map(orderCtx)));
}));

// ---------- agent-to-agent ----------
const a2aView = (x, from, to, svc, order) => ({
  id: x.id, from: from ? mini(from) : null, to: to ? mini(to) : null, serviceTitle: svc?.title, target: x.target, amount: String(x.amount),
  status: x.status, orderId: x.order_id, reportId: order?.report_id || null, createdAt: x.created_at,
});
async function a2aCtx(x) {
  const [f, t, s, o] = await Promise.all([db.get('agents', x.from_agent), db.get('agents', x.to_agent), db.get('services', x.service_id), x.order_id ? db.get('orders', x.order_id) : null]);
  return a2aView(x, f, t, s, o);
}
r.post('/a2a', requireAuth, wrap(async (q, s) => {
  const from = await ownAgent(q, q.body.fromAgentId || '');
  const svc = await db.get('services', q.body.serviceId || '');
  if (!svc) throw notFound('Service not found');
  const target = validateTarget(require('./validators').serviceCatToTask[svc.category], q.body.target);
  s.status(201).json(await a2aCtx(await economy.createA2A({ fromAgent: from, service: svc, target })));
}));
async function ownA2A(q, id) {
  const x = await db.get('a2a_requests', id);
  if (!x) throw notFound();
  await ownAgent(q, x.from_agent);
  return x;
}
r.post('/a2a/:id/approve', requireAuth, wrap(async (q, s) => {
  const x = await ownA2A(q, q.params.id);
  s.json(await a2aCtx(await withLock('a2a:' + x.id, () => economy.approveA2A(x))));
}));
r.post('/a2a/:id/reject', requireAuth, wrap(async (q, s) => {
  const x = await ownA2A(q, q.params.id);
  s.json(await a2aCtx(await economy.rejectA2A(x)));
}));
r.get('/a2a', wrap(async (q, s) => {
  let rows = await db.list('a2a_requests', { limit: 60 });
  if (isUuid(q.query.agentId)) rows = rows.filter((x) => x.from_agent === q.query.agentId || x.to_agent === q.query.agentId);
  s.json(await Promise.all(rows.slice(0, 25).map(a2aCtx)));
}));
// One-click showcase for judges: NVIDIA BRAIN buys industry research from MARKET SCOUT (both demo agents).
r.post('/demo/a2a', demoLimiter, wrap(async (q, s) => {
  if (!cfg.demoMode) throw forbidden('Demo mode is off');
  const agents = (await db.list('agents', { limit: 1000 })).filter((a) => a.config.demo && a.status === 'active');
  const from = agents.find((a) => a.name === 'NVIDIA BRAIN');
  const to = agents.find((a) => a.name === 'MARKET SCOUT');
  if (!from || !to) throw notFound('Demo agents are not available');
  const svc = (await db.list('services', { where: { agent_id: to.id } })).find((x) => x.category === 'industry_research');
  const target = validateTarget('industry_analysis', (q.body && q.body.target) || 'semiconductor');
  const row = await economy.createA2A({ fromAgent: from, service: svc, target });
  s.status(201).json(await a2aCtx(await economy.approveA2A(row)));
}));

// ---------- treasury / portfolio ----------
const bal = (b) => ({ unallocated: b.unallocated.toString(), reserve: b.reserve.toString(), operating: b.operating.toString(), simStocks: b.sim_stocks.toString(), total: b.total.toString() });
r.get('/agents/:id/treasury', wrap(async (q, s) => {
  const a = await loadAgent(q.params.id);
  const [b, t, e] = await Promise.all([ledger.balances(a.id), ledger.totals(a.id), ledger.entries(a.id, 40)]);
  s.json({
    simulated: true, balances: bal(b), revenue: t.revenue.toString(), expenses: t.expenses.toString(), policy: a.config.allocationPolicy,
    entries: e.map((x) => ({ id: x.id, txId: x.tx_id, type: x.tx_type, account: x.account, debit: String(x.debit), credit: String(x.credit), reference: x.reference, at: x.created_at })),
  });
}));
r.get('/agents/:id/portfolio', wrap(async (q, s) => {
  const a = await loadAgent(q.params.id);
  s.json(await portfolio.valuation(a.id));
}));

// ---------- leaderboard / dashboard ----------
r.get('/leaderboard', wrap(async (_q, s) => {
  const [agents, st] = await Promise.all([db.list('agents', { limit: 500 }), statsMap()]);
  const live = agents.filter((a) => a.status !== 'archived');
  const top = (fn, filter = () => true) =>
    live.map((a) => ({ agent: mini(a), value: fn(st.get(a.id) || emptyStats) })).filter((x) => filter(x.value)).sort((a, b) => (BigInt(b.value) > BigInt(a.value) ? 1 : -1)).slice(0, 10).map((x) => ({ ...x, value: String(x.value) }));
  s.json({
    productive: top((x) => x.reports, (v) => v > 0),
    revenue: top((x) => x.revenue, (v) => v > 0n),
    quality: top((x) => (x.reports ? Math.round(x.qualitySum / x.reports) : 0), (v) => v > 0),
    completed: top((x) => x.completedTasks, (v) => v > 0),
    active: top((x) => x.recentTasks, (v) => v > 0),
  });
}));

r.get('/me', requireAuth, wrap(async (q, s) => {
  const [mine, st] = await Promise.all([db.list('agents', { where: { owner_wallet: q.wallet } }), statsMap()]);
  const live = mine.filter((a) => a.status !== 'archived');
  const treasuries = await Promise.all(live.map((a) => ledger.balances(a.id)));
  const totals = await Promise.all(live.map((a) => ledger.totals(a.id)));
  const ids = new Set(live.map((a) => a.id));
  const [tasks, orders] = await Promise.all([db.list('tasks', { limit: 500 }), db.list('orders', { limit: 500 })]);
  const nm = new Map(live.map((a) => [a.id, a]));
  s.json({
    wallet: q.wallet,
    totals: {
      agents: live.length, active: live.filter((a) => a.status === 'active' || a.status === 'processing').length,
      reports: live.reduce((n, a) => n + (st.get(a.id)?.reports || 0), 0),
      revenue: totals.reduce((n, t) => n + t.revenue, 0n).toString(), treasury: treasuries.reduce((n, b) => n + b.total, 0n).toString(),
    },
    agents: live.map((a, i) => ({ ...agentView(a, st.get(a.id)), balances: bal(treasuries[i]) })),
    activity: tasks.filter((t) => ids.has(t.agent_id)).slice(0, 12).map((t) => ({ id: t.id, agent: mini(nm.get(t.agent_id)), type: t.task_type, target: t.target, status: t.status, reportId: t.report_id, at: t.created_at })),
    orders: await Promise.all(orders.filter((o) => ids.has(o.agent_id) || o.buyer === q.wallet).slice(0, 8).map(orderCtx)),
  });
}));

module.exports = r;
