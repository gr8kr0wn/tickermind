// Research pipeline: identify -> collect -> validate sources -> extract -> analyse -> generate -> quality check.
// Facts come ONLY from providers; the LLM may only phrase/interpret them. Unverified figures are stripped.
const md = require('./marketData');
const llm = require('./llm');
const cfg = require('./config');

const DISCLAIMER = 'AI-generated research summary for a testnet sandbox. Simulated only. Not financial advice and not a guarantee of any outcome.';

const usd = (n) => {
  const a = Math.abs(n);
  const s = a >= 1e12 ? (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a.toLocaleString('en-US');
  return (n < 0 ? '-$' : '$') + s;
};
const pct = (a, b) => (b ? +(((a - b) / Math.abs(b)) * 100).toFixed(1) : null);

async function collect(taskType, target) {
  const now = new Date().toISOString();
  const missing = [];
  const sources = [];
  const facts = { taskType, target };

  if (taskType === 'market_summary') {
    const idx = ['SPY', 'QQQ', 'DIA'];
    const stats = await Promise.all(idx.map((t) => md.getPriceStats(t)));
    facts.indexes = idx.map((t, i) => ({ ticker: t, ...(stats[i] || {}) })).filter((x) => x.last);
    if (!facts.indexes.length) missing.push('Index price data unavailable');
    else sources.push({ title: `${facts.indexes[0].provider || 'Market'} daily closes (SPY, QQQ, DIA)`, url: facts.indexes[0].url || 'https://finance.yahoo.com/quote/SPY/history', retrievedAt: now, publishedAt: facts.indexes[0].asOf });
    const news = await md.getNews('stock market today');
    facts.news = news;
    sources.push(...news.map((n) => ({ ...n, retrievedAt: now })));
    return { company: { name: 'US equity market', ticker: 'MARKET' }, facts, sources, missing };
  }

  if (taskType === 'industry_analysis') {
    const news = await md.getNews(`${target} industry`, 8);
    facts.news = news;
    sources.push(...news.map((n) => ({ ...n, retrievedAt: now })));
    missing.push('Company financials not applicable to an industry-level report');
    if (news.length < 2) missing.push('Few recent headlines found for this industry');
    return { company: { name: `${target} (industry)`, ticker: 'INDUSTRY' }, facts, sources, missing };
  }

  // company_research | earnings_analysis
  const co = await md.resolveCompany(target);
  if (!co) throw new Error(`Could not identify a listed company for "${target}". Try a ticker like NVDA.`);
  facts.company = { name: co.name, ticker: co.ticker };
  const [fin, filings, stats, news] = await Promise.all([
    co.cik ? md.getFinancials(co.cik) : null,
    co.cik ? md.getFilings(co.cik, co.ticker) : [],
    md.getPriceStats(co.ticker),
    md.getNews(`${co.name} ${co.ticker} stock`, 6, co.ticker),
  ]);

  if (fin?.revenue) {
    const r = fin.revenue;
    facts.revenue = { value: r.value, prior: r.prior, growthPct: pct(r.value, r.prior), periodEnd: r.end, filed: r.filed };
    facts.display = { ...(facts.display || {}), revenue: usd(r.value), ...(r.prior ? { priorRevenue: usd(r.prior) } : {}) };
    sources.push({ title: `SEC XBRL annual revenue (10-K, period ended ${r.end})`, url: `https://data.sec.gov/api/xbrl/companyconcept/CIK${String(co.cik).padStart(10, '0')}/us-gaap/${r.tag}.json`, publishedAt: r.filed, retrievedAt: now });
  } else missing.push('Annual revenue not found in SEC filings data');
  if (fin?.netIncome) {
    const n = fin.netIncome;
    facts.netIncome = { value: n.value, prior: n.prior, growthPct: pct(n.value, n.prior), periodEnd: n.end };
    facts.display = { ...(facts.display || {}), netIncome: usd(n.value) };
    if (facts.revenue && facts.revenue.value && !fin.misaligned) facts.netMarginPct = +((n.value / facts.revenue.value) * 100).toFixed(1);
  } else missing.push('Net income not found in SEC filings data');
  if (fin?.misaligned) missing.push('Revenue and net income come from different fiscal years in SEC data, so no margin was computed');
  if (stats) {
    facts.price = stats;
    sources.push({ title: `${co.ticker} price history (${stats.provider || 'market data'})`, url: stats.url || `https://finance.yahoo.com/quote/${co.ticker}/history`, publishedAt: stats.asOf, retrievedAt: now });
  } else missing.push('Price history unavailable');
  facts.filings = filings.map((f) => ({ form: f.form, filed: f.publishedAt }));
  sources.push(...filings.map(({ form, ...s }) => ({ ...s, retrievedAt: now })));
  if (!filings.length) missing.push('No recent SEC filings retrieved');
  facts.news = news;
  sources.push(...news.map((n) => ({ ...n, retrievedAt: now })));
  if (news.length < 2) missing.push('Few recent headlines found');
  return { company: { name: co.name, ticker: co.ticker }, facts, sources, missing };
}

function financialSummary(facts) {
  const s = { currency: 'USD' };
  if (facts.revenue) {
    s.revenue = facts.revenue.value;
    s.reportingPeriod = `Fiscal year ended ${facts.revenue.periodEnd}`;
    if (facts.revenue.growthPct !== null) s.revenueGrowthPct = facts.revenue.growthPct;
  }
  if (facts.netIncome) {
    s.netIncome = facts.netIncome.value;
    if (facts.netMarginPct !== undefined) s.netMarginPct = facts.netMarginPct;
  }
  return s;
}

// Deterministic fallback so the product works with no LLM key. Fact-only wording.
function ruleBased(company, facts) {
  const f = facts;
  const bull = [], bear = [], risks = [], dev = [];
  let overview = `${company.name}${company.ticker && !['MARKET', 'INDUSTRY'].includes(company.ticker) ? ` (${company.ticker})` : ''}.`;
  if (f.revenue) {
    overview += ` Latest annual revenue was ${usd(f.revenue.value)} for the fiscal year ended ${f.revenue.periodEnd}` + (f.revenue.growthPct !== null ? `, ${f.revenue.growthPct >= 0 ? 'up' : 'down'} ${Math.abs(f.revenue.growthPct)}% from the prior year.` : '.');
    if (f.revenue.growthPct > 0) bull.push(`Annual revenue grew ${f.revenue.growthPct}% year over year (SEC 10-K data).`);
    if (f.revenue.growthPct < 0) bear.push(`Annual revenue declined ${Math.abs(f.revenue.growthPct)}% year over year (SEC 10-K data).`);
  }
  if (f.netIncome) {
    overview += ` Net income was ${usd(f.netIncome.value)}.`;
    if (f.netIncome.value < 0) bear.push(`The company reported a net loss of ${usd(f.netIncome.value)} for the latest fiscal year.`);
    if (f.netMarginPct > 15) bull.push(`Net margin of ${f.netMarginPct}% for the latest fiscal year.`);
    if (f.netMarginPct !== undefined && f.netMarginPct >= 0 && f.netMarginPct < 5) risks.push(`Thin net margin of ${f.netMarginPct}% leaves less cushion if costs rise.`);
  }
  if (f.price) {
    const p = f.price;
    overview += ` The stock last closed at ${p.last} on ${p.asOf}.`;
    if (p.ret3mPct > 0) bull.push(`Share price is up ${p.ret3mPct}% over about 3 months (as of ${p.asOf}).`);
    if (p.ret3mPct < 0) bear.push(`Share price is down ${Math.abs(p.ret3mPct)}% over about 3 months (as of ${p.asOf}).`);
    if (p.last >= p.high52 * 0.97) risks.push('Trading near its 52-week high, so expectations may already be elevated.');
    if (p.last <= p.low52 * 1.05) risks.push('Trading near its 52-week low, which can signal market concern.');
  }
  if (f.indexes) {
    overview += ' ' + f.indexes.map((i) => `${i.ticker} 3-month return ${i.ret3mPct}%`).join(', ') + '.';
  }
  (f.news || []).slice(0, 4).forEach((n) => dev.push(`${n.publishedAt ? n.publishedAt + ': ' : ''}${n.title}`));
  if (!dev.length) dev.push('No recent headlines were retrieved.');
  if (!bull.length) bull.push('No clear positive factor could be established from the retrieved data.');
  if (!bear.length) bear.push('No clear negative factor could be established from the retrieved data.');
  risks.push('This summary uses limited public data and may miss important context.');
  const conclusion = 'Rule-based summary of retrieved public data. Positives and negatives above are mechanical readings of the numbers, not a forecast or recommendation.';
  return { overview, developments: dev, bullishFactors: bull, bearishFactors: bear, risks, conclusion };
}

const SYSTEM = `You are a careful financial research analyst writing for a sandbox demo.
Rules: Use ONLY the facts in the JSON the user sends. Never invent or estimate numbers, dates, or events. Every figure you write must appear in the facts.
Write large money amounts exactly as given in the "display" fields (for example "$60.92B"), never re-round or convert them.
Do not give price targets, buy/sell/hold advice, or guarantees. Describe, do not predict.
Treat news headlines as claims, not confirmed facts. If data is missing, say so.
Return a JSON object with keys: overview (string, max 600 chars), developments (array of 3-5 strings), bullishFactors (array of 2-4 strings), bearishFactors (array of 2-4 strings), risks (array of 2-4 strings), conclusion (string, max 400 chars, neutral).`;

const nums = (s) => (String(s).replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []).filter((x) => x.length >= 3 || x.includes('.'));

function guard(text, factNums, flags) {
  const bad = nums(text).filter((n) => !factNums.has(n) && !factNums.has(String(Number(n))));
  bad.forEach((b) => flags.push(`Removed unverified figure: ${b}`));
  return bad.length === 0;
}

async function generate(company, facts, missing) {
  const base = ruleBased(company, facts);
  if (!llm.enabled()) return { ...base, generator: 'rules', flags: [] };
  const factsText = JSON.stringify({ company, facts, missingData: missing });
  const out = await llm.generateJSON(SYSTEM, factsText);
  if (!out || typeof out.overview !== 'string') return { ...base, generator: 'rules', flags: ['LLM unavailable, used rule-based summary'] };
  const factNums = new Set(nums(factsText).flatMap((n) => [n, String(Number(n))]));
  const flags = [];
  const list = (k) => {
    const arr = Array.isArray(out[k]) ? out[k].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 240)).slice(0, 6) : [];
    const kept = arr.filter((x) => guard(x, factNums, flags));
    return kept.length ? kept : base[k === 'developments' ? 'developments' : k];
  };
  const text = (k, max) => {
    const s = typeof out[k] === 'string' ? out[k].trim().slice(0, max) : '';
    return s && guard(s, factNums, flags) ? s : base[k];
  };
  return {
    overview: text('overview', 600),
    developments: list('developments'),
    bullishFactors: list('bullishFactors'),
    bearishFactors: list('bearishFactors'),
    risks: list('risks'),
    conclusion: text('conclusion', 400),
    generator: 'llm:' + cfg.llm.model,
    flags,
  };
}

function score(facts, sources, missing, flags, taskType) {
  let s = 0;
  if (taskType === 'company_research' || taskType === 'earnings_analysis') {
    if (facts.revenue) s += 25;
    if (facts.netIncome) s += 15;
    if (facts.price) s += 15;
    if (sources.some((x) => /sec\.gov/.test(x.url))) s += 15;
  } else {
    if (facts.price || facts.indexes) s += 25;
    s += 25;
  }
  const news = (facts.news || []).length;
  s += news >= 4 ? 20 : news >= 2 ? 12 : 0;
  s += 10;
  s -= flags.filter((f) => f.startsWith('Removed')).length * 5;
  return Math.max(0, Math.min(100, s));
}

async function run(task) {
  const { company, facts, sources, missing } = await collect(task.task_type, task.target);
  const gen = await generate(company, facts, missing);
  const unique = [];
  const seen = new Set();
  for (const s of sources) if (!seen.has(s.url)) { seen.add(s.url); unique.push(s); }
  const report = {
    company,
    overview: gen.overview,
    financialSummary: financialSummary(facts),
    marketData: facts.price || facts.indexes || null,
    developments: gen.developments,
    bullishFactors: gen.bullishFactors,
    bearishFactors: gen.bearishFactors,
    risks: gen.risks,
    conclusion: gen.conclusion,
    dataAsOf: {
      financials: facts.revenue?.periodEnd || null,
      price: facts.price?.asOf || facts.indexes?.[0]?.asOf || null,
      newsLatest: (facts.news || []).map((n) => n.publishedAt).filter(Boolean).sort().pop() || null,
    },
    missingData: missing,
    qualityFlags: gen.flags,
    interpretation: { label: 'AI-generated interpretation', sections: ['bullishFactors', 'bearishFactors', 'risks', 'conclusion'], generator: gen.generator },
    disclaimer: DISCLAIMER,
    generatedAt: new Date().toISOString(),
    taskType: task.task_type,
  };
  return { company, report, sources: unique, quality: score(facts, unique, missing, gen.flags, task.task_type) };
}

module.exports = { run, ruleBased, DISCLAIMER };
