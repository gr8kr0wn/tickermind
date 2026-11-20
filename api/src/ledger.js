// Double-entry ledger + treasury operations. Amounts are BigInt micro-USDC (6 dp).
// Balance of an account = SUM(debit) - SUM(credit). Every tx_id balances to zero.
// The DB ledger is the accounting source for SIMULATED balances; onchain events are the
// independently verifiable payment record.
const crypto = require('crypto');
const db = require('./db');
const { toDb, fromDb, splitByPercent } = require('./money');
const { withLock, bad } = require('./util');

const ACCOUNTS = ['unallocated', 'reserve', 'operating', 'sim_stocks'];
const EXT = { revenue: 'external:revenue', faucet: 'external:faucet', expenses: 'external:expenses', escrow: 'external:escrow' };

async function post(txType, reference, lines) {
  let d = 0n;
  let c = 0n;
  for (const l of lines) {
    d += l.debit || 0n;
    c += l.credit || 0n;
    if ((l.debit || 0n) < 0n || (l.credit || 0n) < 0n) throw new Error('Negative ledger line');
  }
  if (d !== c || d === 0n) throw new Error(`Unbalanced ledger transaction (${d} vs ${c})`);
  const txId = crypto.randomUUID();
  const rows = lines
    .filter((l) => (l.debit || 0n) + (l.credit || 0n) > 0n)
    .map((l) => ({
      tx_id: txId,
      agent_id: l.agentId || null,
      account: l.account,
      debit: toDb(l.debit || 0n),
      credit: toDb(l.credit || 0n),
      currency: 'USDC',
      tx_type: txType,
      reference: reference || null,
      status: 'posted',
    }));
  await db.insertMany('ledger_entries', rows);
  return txId;
}

async function balances(agentId) {
  const rows = await db.list('ledger_entries', { where: { agent_id: agentId }, limit: 20000 });
  const b = { unallocated: 0n, reserve: 0n, operating: 0n, sim_stocks: 0n };
  for (const r of rows) if (r.account in b) b[r.account] += fromDb(r.debit) - fromDb(r.credit);
  b.total = b.unallocated + b.reserve + b.operating + b.sim_stocks;
  return b;
}

async function totals(agentId) {
  const rows = await db.list('ledger_entries', { where: { agent_id: agentId }, limit: 20000 });
  let revenue = 0n;
  let expenses = 0n;
  for (const r of rows) {
    if (r.tx_type === 'revenue' && r.account === 'unallocated') revenue += fromDb(r.debit);
    if (r.tx_type === 'expense' && r.account === 'operating') expenses += fromDb(r.credit);
  }
  return { revenue, expenses };
}

async function entries(agentId, limit = 50) {
  return db.list('ledger_entries', { where: { agent_id: agentId }, limit });
}

const lock = (agentId, fn) => withLock('agent:' + agentId, fn);

async function faucet(agentId, amount) {
  return lock(agentId, () =>
    post('faucet', 'starter grant (simulated)', [
      { agentId, account: 'operating', debit: amount },
      { agentId: null, account: EXT.faucet, credit: amount },
    ])
  );
}

// Credit revenue to unallocated, then split by the agent's allocation policy.
async function receiveRevenue(agent, amount, ref, { counter = EXT.revenue, txType = 'revenue' } = {}) {
  let stocksPart = 0n;
  await lock(agent.id, async () => {
    await post(txType, ref, [
      { agentId: agent.id, account: 'unallocated', debit: amount },
      { agentId: null, account: counter, credit: amount },
    ]);
    const p = agent.config.allocationPolicy;
    const [r, s, o] = splitByPercent(amount, [p.reservePercentage, p.simulatedStockPercentage, p.operatingPercentage]);
    stocksPart = s;
    await post('allocation', ref, [
      { agentId: agent.id, account: 'reserve', debit: r },
      { agentId: agent.id, account: 'sim_stocks', debit: s },
      { agentId: agent.id, account: 'operating', debit: o },
      { agentId: agent.id, account: 'unallocated', credit: amount },
    ]);
  });
  if (stocksPart > 0n && agent.config.permissions.simulateAllocations) {
    try {
      await require('./portfolio').buy(agent, stocksPart);
    } catch (e) {
      console.warn('[portfolio] simulated buy skipped:', e.message);
    }
  }
}

async function escrowHold(fromAgentId, amount, ref) {
  return lock(fromAgentId, async () => {
    const b = await balances(fromAgentId);
    if (b.operating < amount) throw bad('Not enough operating balance for this request');
    return post('escrow_hold', ref, [
      { agentId: fromAgentId, account: 'operating', credit: amount },
      { agentId: null, account: EXT.escrow, debit: amount },
    ]);
  });
}
async function escrowRefund(fromAgentId, amount, ref) {
  return lock(fromAgentId, () =>
    post('escrow_refund', ref, [
      { agentId: fromAgentId, account: 'operating', debit: amount },
      { agentId: null, account: EXT.escrow, credit: amount },
    ])
  );
}
async function escrowRelease(toAgent, amount, ref) {
  // escrow -> provider's unallocated, then allocate. Reuse revenue path with escrow as the counter-account.
  return receiveRevenue(toAgent, amount, ref, { counter: EXT.escrow, txType: 'revenue' });
}

// simulated compute cost: only charged if the agent can afford it
async function expense(agentId, amount, ref) {
  return lock(agentId, async () => {
    const b = await balances(agentId);
    if (b.operating < amount) return null;
    return post('expense', ref, [
      { agentId: null, account: EXT.expenses, debit: amount },
      { agentId, account: 'operating', credit: amount },
    ]);
  });
}

// For tests/health: every tx must balance, and escrow must never go negative.
async function checkInvariants() {
  const rows = await db.list('ledger_entries', { limit: 1000000 });
  const byTx = new Map();
  for (const r of rows) {
    const t = byTx.get(r.tx_id) || { d: 0n, c: 0n };
    t.d += fromDb(r.debit);
    t.c += fromDb(r.credit);
    byTx.set(r.tx_id, t);
  }
  const broken = [...byTx.entries()].filter(([, t]) => t.d !== t.c).map(([id]) => id);
  let escrow = 0n;
  for (const r of rows) if (r.account === EXT.escrow) escrow += fromDb(r.debit) - fromDb(r.credit);
  return { transactions: byTx.size, broken, escrow };
}

module.exports = { ACCOUNTS, EXT, post, balances, totals, entries, faucet, receiveRevenue, escrowHold, escrowRefund, escrowRelease, expense, checkInvariants };
