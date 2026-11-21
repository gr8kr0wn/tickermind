// Simulated portfolio: hypothetical positions only (NOT tokenized stocks, no real trades).
// All math is integer BigInt. Shares are micro-shares (1e6 = 1 share), prices micro-USD.
const db = require('./db');
const { ONE, toDb, fromDb } = require('./money');
const md = require('./marketData');

const TICKER_RE = /^[A-Z]{1,5}$/;
const DEFAULT_WATCH = ['NVDA', 'AAPL', 'MSFT'];

function watchlist(agent) {
  const t = (agent.config.researchTargets || []).filter((x) => TICKER_RE.test(x)).slice(0, 5);
  return t.length ? t : DEFAULT_WATCH;
}

async function buy(agent, cash) {
  const spy = await md.getQuote('SPY');
  if (!spy) throw new Error('No benchmark price');
  const quotes = [];
  for (const t of watchlist(agent)) {
    const q = await md.getQuote(t);
    if (q) quotes.push({ ticker: t, ...q });
  }
  if (!quotes.length) throw new Error('No priced tickers in watchlist');
  const n = BigInt(quotes.length);
  const each = cash / n;
  let rem = cash - each * n;
  for (const q of quotes) {
    const alloc = each + rem;
    rem = 0n;
    const shares = (alloc * ONE) / q.priceMicro;
    if (shares <= 0n) continue;
    const cost = (shares * q.priceMicro) / ONE;
    const bench = (cost * ONE) / spy.priceMicro;
    await db.insert('positions', {
      agent_id: agent.id,
      ticker: q.ticker,
      shares: toDb(shares),
      cost_micro: toDb(cost),
      bench_units: toDb(bench),
      price_micro: toDb(q.priceMicro),
      price_source: q.source,
    });
  }
}

const bps = (num, den) => (den === 0n ? 0n : (num * 10000n) / den);

async function valuation(agentId) {
  const { balances } = require('./ledger');
  const [rows, bal] = await Promise.all([db.list('positions', { where: { agent_id: agentId }, order: 'created_at', desc: false }), balances(agentId)]);
  const byTicker = new Map();
  for (const r of rows) {
    const p = byTicker.get(r.ticker) || { ticker: r.ticker, shares: 0n, cost: 0n, bench: 0n };
    p.shares += fromDb(r.shares);
    p.cost += fromDb(r.cost_micro);
    p.bench += fromDb(r.bench_units);
    byTicker.set(r.ticker, p);
  }
  const spy = rows.length ? await md.getQuote('SPY') : null;
  let positionsValue = 0n, totalCost = 0n, benchValue = 0n;
  let anySynthetic = spy ? spy.source === 'synthetic' : false;
  const positions = [];
  for (const p of byTicker.values()) {
    const q = await md.getQuote(p.ticker);
    const price = q ? q.priceMicro : p.cost > 0n ? (p.cost * ONE) / p.shares : 0n;
    if (q && q.source === 'synthetic') anySynthetic = true;
    const value = (p.shares * price) / ONE;
    positionsValue += value;
    totalCost += p.cost;
    if (spy) benchValue += (p.bench * spy.priceMicro) / ONE;
    positions.push({
      ticker: p.ticker, shares: p.shares.toString(), cost: p.cost.toString(), price: price.toString(),
      value: value.toString(), pnl: (value - p.cost).toString(), pnlBps: bps(value - p.cost, p.cost).toString(),
    });
  }
  const cash = bal.sim_stocks - totalCost;
  const total = cash + positionsValue;
  return {
    simulated: true,
    note: 'Hypothetical positions for demonstration. Not real holdings, not tokenized stocks, not advice.',
    priceSource: anySynthetic ? 'synthetic (live price provider unreachable)' : 'daily closes (Stooq or Yahoo Finance)',
    cash: cash.toString(),
    positionsValue: positionsValue.toString(),
    totalValue: total.toString(),
    invested: totalCost.toString(),
    unrealizedPnl: (positionsValue - totalCost).toString(),
    realizedPnl: '0',
    returnBps: bps(positionsValue - totalCost, totalCost).toString(),
    benchmark: { name: 'SPY', value: benchValue.toString(), returnBps: bps(benchValue - totalCost, totalCost).toString() },
    positions: positions.sort((a, b) => (BigInt(b.value) > BigInt(a.value) ? 1 : -1)),
    history: rows.map((r) => ({ at: r.created_at, ticker: r.ticker, cost: String(r.cost_micro), price: String(r.price_micro) })).reverse().slice(0, 30),
  };
}

module.exports = { buy, valuation, watchlist };
