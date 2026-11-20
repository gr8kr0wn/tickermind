// Demo agents so the marketplace and leaderboard are alive on first run. Owned by a burn address,
// funded with a SIMULATED starter grant, clearly flagged config.demo = true.
const db = require('./db');
const ledger = require('./ledger');
const economy = require('./economy');
const { parseUnits } = require('./money');
const { DEFAULT_PERMS } = require('./validators');

const DEMO_WALLET = '0x000000000000000000000000000000000000dead';
const pol = { reservePercentage: 40, simulatedStockPercentage: 40, operatingPercentage: 20 };

const AGENTS = [
  { name: 'NVIDIA BRAIN', specialization: 'technology', avatar: '0', description: 'Semiconductor and AI hardware company research.', targets: ['NVDA', 'AMD', 'TSM'],
    services: [{ title: 'Company deep-dive', category: 'company_research', price: '5', description: 'Filings, financials, price context and recent headlines for one company.' }] },
  { name: 'MARKET SCOUT', specialization: 'general', avatar: '3', description: 'Industry and broad market intelligence.', targets: ['SPY', 'QQQ'],
    services: [
      { title: 'Industry research', category: 'industry_research', price: '4', description: 'Recent developments and risks for an industry.' },
      { title: 'Market snapshot', category: 'market_intelligence', price: '2', description: 'US index performance and headlines.' },
    ] },
  { name: 'BIOTECH LENS', specialization: 'healthcare', avatar: '5', description: 'Healthcare and pharma earnings breakdowns.', targets: ['LLY', 'PFE', 'MRNA'],
    services: [{ title: 'Earnings breakdown', category: 'earnings_analysis', price: '3', description: 'Latest annual results and what changed.' }] },
  { name: 'ENERGY WATCH', specialization: 'energy', avatar: '8', description: 'Oil, gas and utilities research.', targets: ['XOM', 'CVX'],
    services: [{ title: 'Energy company report', category: 'company_research', price: '3', description: 'Fundamentals and headlines for an energy company.' }] },
];

async function seed({ withReports = true } = {}) {
  const existing = await db.list('agents', { limit: 1000 });
  if (existing.some((a) => a.config && a.config.demo)) return;
  const created = [];
  for (const d of AGENTS) {
    const agent = await db.insert('agents', {
      owner_wallet: DEMO_WALLET, onchain_agent_id: null, register_tx: null, name: d.name, description: d.description,
      specialization: d.specialization, avatar: d.avatar, status: 'active',
      config: { demo: true, researchTargets: d.targets, researchFrequency: 'on_demand', permissions: { ...DEFAULT_PERMS }, allocationPolicy: { ...pol } },
    });
    await ledger.faucet(agent.id, parseUnits('200'));
    for (const s of d.services) await db.insert('services', { agent_id: agent.id, title: s.title, description: s.description, category: s.category, price: Number(parseUnits(s.price)), currency: 'USDC', est_minutes: 3, is_active: true });
    created.push(agent);
  }
  if (withReports) {
    const [nv, sc, bio] = created;
    try {
      await economy.enqueue({ agent: nv, taskType: 'company_research', target: 'NVDA', requestedBy: 'seed' });
      await economy.enqueue({ agent: sc, taskType: 'market_summary', target: 'US market', requestedBy: 'seed' });
      await economy.enqueue({ agent: bio, taskType: 'earnings_analysis', target: 'LLY', requestedBy: 'seed' });
    } catch (e) { console.warn('[seed]', e.message); }
  }
  console.log('[seed] created demo agents');
}

module.exports = { seed, DEMO_WALLET };
