// Orders, agent-to-agent (A2A) requests, escrow and settlement. All money via the ledger.
const db = require('./db');
const cfg = require('./config');
const ledger = require('./ledger');
const { fromDb } = require('./money');
const { bad, forbidden, conflict, notFound } = require('./util');
const { serviceCatToTask } = require('./validators');

const COMPUTE_COST = 50_000n; // 0.05 USDC simulated compute cost per finished task

async function enqueue({ agent, taskType, target, requestedBy, orderId = null }) {
  if (['paused', 'archived', 'failed', 'pending'].includes(agent.status)) throw conflict('Agent is not active');
  if (!agent.config.permissions.generateReports) throw forbidden('This agent is not permitted to generate reports');
  const since = Date.now() - 3600_000;
  const recent = (await db.list('tasks', { where: { agent_id: agent.id }, limit: 200 })).filter((t) => new Date(t.created_at).getTime() > since);
  if (recent.length >= cfg.maxTasksPerAgentPerHour) throw new (require('./util').HttpError)(429, 'This agent is at its hourly task limit');
  return db.insert('tasks', { agent_id: agent.id, task_type: taskType, target, status: 'pending', requested_by: requestedBy, order_id: orderId, error: null, report_id: null, completed_at: null });
}

async function startPaidOrder(order, agent, service) {
  await db.update('orders', order.id, { status: 'processing' });
  return enqueue({ agent, taskType: serviceCatToTask[service.category], target: order.target, requestedBy: order.buyer, orderId: order.id });
}

// ---------- A2A ----------
async function createA2A({ fromAgent, service, target }) {
  const toAgent = await db.get('agents', service.agent_id);
  if (!toAgent) throw notFound('Provider agent not found');
  if (toAgent.id === fromAgent.id) throw bad('An agent cannot buy from itself');
  if (!fromAgent.config.permissions.requestServices) throw forbidden('This agent is not allowed to request services');
  if (fromAgent.status !== 'active') throw conflict('Requesting agent is not active');
  if (toAgent.status !== 'active' || !toAgent.config.permissions.acceptTasks || !toAgent.config.permissions.receivePayments)
    throw conflict('Provider agent is not accepting paid tasks');
  if (!service.is_active) throw conflict('Service is not active');
  const amount = fromDb(service.price);
  const bal = await ledger.balances(fromAgent.id);
  if (bal.operating < amount) throw bad('Requesting agent does not have enough simulated operating funds');
  return db.insert('a2a_requests', { from_agent: fromAgent.id, to_agent: toAgent.id, service_id: service.id, target, amount: Number(amount), status: 'pending_approval', order_id: null });
}

async function approveA2A(reqRow) {
  if (reqRow.status !== 'pending_approval') throw conflict('Request is not waiting for approval');
  const [from, to, service] = await Promise.all([db.get('agents', reqRow.from_agent), db.get('agents', reqRow.to_agent), db.get('services', reqRow.service_id)]);
  if (!from || !to || !service) throw notFound('Request references missing records');
  if (!to.config.permissions.acceptTasks || !to.config.permissions.receivePayments || to.status !== 'active') throw conflict('Provider is no longer accepting tasks');
  const amount = fromDb(reqRow.amount);
  await ledger.escrowHold(from.id, amount, 'a2a:' + reqRow.id); // throws if insufficient funds
  try {
    const order = await db.insert('orders', { buyer: 'agent:' + from.id, service_id: service.id, agent_id: to.id, target: reqRow.target, amount: reqRow.amount, tx_hash: null, status: 'paid', kind: 'a2a', report_id: null });
    await db.update('a2a_requests', reqRow.id, { status: 'approved', order_id: order.id });
    await startPaidOrder(order, to, service);
    return db.get('a2a_requests', reqRow.id);
  } catch (e) {
    await ledger.escrowRefund(from.id, amount, 'a2a-rollback:' + reqRow.id);
    await db.update('a2a_requests', reqRow.id, { status: 'failed' });
    throw e;
  }
}

async function rejectA2A(reqRow) {
  if (reqRow.status !== 'pending_approval') throw conflict('Request is not waiting for approval');
  return db.update('a2a_requests', reqRow.id, { status: 'rejected' });
}

// ---------- settlement (called by the worker when a task ends) ----------
async function settle(task, agent, report, ok) {
  if (!task.order_id) return;
  const order = await db.get('orders', task.order_id);
  if (!order) return;
  const amount = fromDb(order.amount);
  const [a2a] = order.kind === 'a2a' ? await db.list('a2a_requests', { where: { order_id: order.id }, limit: 1 }) : [];
  if (ok) {
    await db.update('orders', order.id, { status: 'delivered', report_id: report.id });
    if (order.kind === 'a2a') {
      await ledger.escrowRelease(agent, amount, 'order:' + order.id);
      if (a2a) await db.update('a2a_requests', a2a.id, { status: 'completed' });
    } else if (agent.config.permissions.receivePayments) {
      await ledger.receiveRevenue(agent, amount, 'order:' + order.id);
    }
    await db.update('orders', order.id, { status: 'completed' });
  } else {
    await db.update('orders', order.id, { status: 'refunded' });
    if (order.kind === 'a2a') {
      const fromId = order.buyer.replace('agent:', '');
      await ledger.escrowRefund(fromId, amount, 'order-failed:' + order.id);
      if (a2a) await db.update('a2a_requests', a2a.id, { status: 'failed' });
    }
    // human onchain payments cannot be reversed automatically; the owner refunds manually (documented)
  }
}

module.exports = { enqueue, startPaidOrder, createA2A, approveA2A, rejectA2A, settle, COMPUTE_COST };
