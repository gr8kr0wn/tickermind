const { bad } = require('./util');
const { parseUnits } = require('./money');

const SPECS = ['technology', 'healthcare', 'energy', 'finance', 'general'];
const FREQ = ['on_demand', 'daily', 'weekly'];
const TASK_TYPES = ['company_research', 'earnings_analysis', 'industry_analysis', 'market_summary'];
const SERVICE_CATS = ['company_research', 'earnings_analysis', 'industry_research', 'market_intelligence'];
const PERM_KEYS = ['readMarketData', 'generateReports', 'publishReports', 'acceptTasks', 'receivePayments', 'simulateAllocations', 'requestServices'];
const DEFAULT_PERMS = {
  readMarketData: true,
  generateReports: true,
  publishReports: true,
  acceptTasks: true,
  receivePayments: true,
  simulateAllocations: true,
  requestServices: true,
};

const str = (v, max, name, { min = 0 } = {}) => {
  if (typeof v !== 'string') throw bad(`${name} must be text`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw bad(`${name} must be ${min}-${max} characters`);
  return s;
};

function validateAgentConfig(b, { partial = false } = {}) {
  const out = {};
  if (!partial || b.name !== undefined) out.name = str(b.name ?? '', 40, 'Name', { min: 2 });
  if (!partial || b.description !== undefined) out.description = str(b.description ?? '', 280, 'Description');
  if (!partial || b.specialization !== undefined) {
    if (!SPECS.includes(b.specialization)) throw bad('Unknown specialization');
    out.specialization = b.specialization;
  }
  if (!partial || b.avatar !== undefined) {
    const a = Number(b.avatar ?? 0);
    if (!Number.isInteger(a) || a < 0 || a > 11) throw bad('Bad avatar');
    out.avatar = String(a);
  }
  const config = {};
  if (!partial || b.researchTargets !== undefined) {
    const t = Array.isArray(b.researchTargets) ? b.researchTargets : [];
    if (t.length > 10) throw bad('Max 10 research targets');
    config.researchTargets = [...new Set(t.map((x) => str(String(x), 40, 'Target', { min: 1 }).toUpperCase()))];
  }
  if (!partial || b.researchFrequency !== undefined) {
    if (!FREQ.includes(b.researchFrequency ?? 'on_demand')) throw bad('Bad research frequency');
    config.researchFrequency = b.researchFrequency ?? 'on_demand';
  }
  if (!partial || b.permissions !== undefined) {
    const p = { ...DEFAULT_PERMS, ...(b.permissions || {}) };
    config.permissions = {};
    for (const k of PERM_KEYS) config.permissions[k] = !!p[k];
  }
  if (!partial || b.allocationPolicy !== undefined) {
    const a = b.allocationPolicy || { reservePercentage: 40, simulatedStockPercentage: 40, operatingPercentage: 20 };
    const nums = [a.reservePercentage, a.simulatedStockPercentage, a.operatingPercentage].map(Number);
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 100)) throw bad('Allocation must be whole percentages');
    if (nums[0] + nums[1] + nums[2] !== 100) throw bad('Allocation must total exactly 100%');
    config.allocationPolicy = {
      reservePercentage: nums[0],
      simulatedStockPercentage: nums[1],
      operatingPercentage: nums[2],
    };
  }
  return { fields: out, config };
}

function validateService(b) {
  if (!SERVICE_CATS.includes(b.category)) throw bad('Unknown category');
  let price;
  try {
    price = parseUnits(b.price);
  } catch (_) {
    throw bad('Price must be like 5 or 2.50');
  }
  if (price < 10_000n || price > 1_000_000_000n) throw bad('Price must be between 0.01 and 1000 USDC');
  const est = Number(b.estMinutes ?? 5);
  if (!Number.isInteger(est) || est < 1 || est > 1440) throw bad('Bad delivery estimate');
  return {
    title: str(b.title ?? '', 80, 'Title', { min: 3 }),
    description: str(b.description ?? '', 400, 'Description'),
    category: b.category,
    price,
    est_minutes: est,
  };
}

function validateTarget(taskType, target) {
  if (!TASK_TYPES.includes(taskType)) throw bad('Unknown task type');
  const t = str(String(target ?? ''), 60, 'Target', { min: 1 });
  if (!/^[\w .,&'\-]+$/.test(t)) throw bad('Target has unsupported characters');
  return t;
}

const serviceCatToTask = {
  company_research: 'company_research',
  earnings_analysis: 'earnings_analysis',
  industry_research: 'industry_analysis',
  market_intelligence: 'market_summary',
};

module.exports = { validateAgentConfig, validateService, validateTarget, SPECS, TASK_TYPES, SERVICE_CATS, DEFAULT_PERMS, serviceCatToTask };
