// Provider + research pipeline tests with a mocked fetch that returns payloads in the documented
// SEC XBRL / Stooq CSV / Google News RSS formats. Also proves the LLM numeric guard.
const os = require('os');
const path = require('path');
const assert = require('assert');
process.env.LOCAL_DB_FILE = path.join(os.tmpdir(), 'tm-prov-' + Date.now() + '.json');
process.env.LLM_API_KEY = 'test-key';
process.env.LLM_MODEL = 'test-model';

const SEC_REV = { cik: 1045810, taxonomy: 'us-gaap', tag: 'RevenueFromContractWithCustomerExcludingAssessedTax', units: { USD: [
  { start: '2023-01-30', end: '2023-04-30', val: 7192000000, accn: 'a1', fy: 2024, fp: 'Q1', form: '10-Q', filed: '2023-05-24' },
  { start: '2022-01-31', end: '2023-01-29', val: 26974000000, accn: 'a2', fy: 2023, fp: 'FY', form: '10-K', filed: '2023-02-24' },
  { start: '2023-01-30', end: '2024-01-28', val: 60922000000, accn: 'a3', fy: 2024, fp: 'FY', form: '10-K', filed: '2024-02-21' },
] } };
const SEC_NI = { units: { USD: [
  { start: '2022-01-31', end: '2023-01-29', val: 4368000000, fp: 'FY', form: '10-K', filed: '2023-02-24' },
  { start: '2023-01-30', end: '2024-01-28', val: 29760000000, fp: 'FY', form: '10-K', filed: '2024-02-21' },
] } };
const SUBS = { filings: { recent: { form: ['4', '8-K', '10-Q', '10-K'], filingDate: ['2024-03-01', '2024-02-21', '2023-11-21', '2023-02-24'], accessionNumber: ['0001-24-1', '0001-24-2', '0001-23-3', '0001-23-4'], primaryDocument: ['x.xml', 'd8k.htm', 'q.htm', 'k.htm'] } } };
const TICKERS = { 0: { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' }, 1: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } };
const csv = () => {
  const rows = ['Date,Open,High,Low,Close,Volume'];
  for (let i = 0; i < 300; i++) { const d = new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10); rows.push(`${d},1,2,0.5,${100 + i * 0.1},1000`); }
  return rows.join('\n');
};
const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Chip maker beats estimates &amp; raises outlook</title><link>https://news.example/a</link><pubDate>Wed, 20 Mar 2024 10:00:00 GMT</pubDate></item>
<item><title>Regulators look at AI chip exports</title><link>https://news.example/b</link><pubDate>Tue, 19 Mar 2024 10:00:00 GMT</pubDate></item>
</channel></rss>`;

let llmReply;
global.fetch = async (url) => {
  const u = String(url);
  const ok = (body, json = true) => ({ ok: true, status: 200, text: async () => (json ? JSON.stringify(body) : body), json: async () => body });
  if (u.includes('company_tickers.json')) return ok(TICKERS);
  if (u.includes('/companyconcept/') && u.includes('RevenueFromContract')) return ok(SEC_REV);
  if (u.includes('/companyconcept/') && u.includes('NetIncomeLoss')) return ok(SEC_NI);
  if (u.includes('/companyconcept/')) return { ok: false, status: 404, text: async () => '{}' };
  if (u.includes('/submissions/')) return ok(SUBS);
  if (u.includes('stooq.com')) return ok(csv(), false);
  if (u.includes('news.google.com')) return ok(RSS, false);
  if (u.includes('chat/completions')) return ok({ choices: [{ message: { content: JSON.stringify(llmReply) } }] });
  throw new Error('unmocked url ' + u);
};

const md = require('../src/marketData');
const research = require('../src/research');
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('  ok -', name); };

(async () => {
  await t('resolves company by ticker and by name', async () => {
    assert.equal((await md.resolveCompany('nvda')).cik, 1045810);
    assert.equal((await md.resolveCompany('apple')).ticker, 'AAPL');
    assert.equal(await md.resolveCompany('zzzz-not-real'), null);
  });

  await t('SEC XBRL: picks latest annual 10-K figure and prior year, ignores quarterly rows', async () => {
    const f = await md.getFinancials(1045810);
    assert.equal(f.revenue.value, 60922000000);
    assert.equal(f.revenue.prior, 26974000000);
    assert.equal(f.revenue.end, '2024-01-28');
    assert.equal(f.netIncome.value, 29760000000);
  });

  await t('filings: keeps only 10-K/10-Q/8-K and builds EDGAR URLs', async () => {
    const f = await md.getFilings(1045810, 'NVDA');
    assert.deepEqual(f.map((x) => x.form), ['8-K', '10-Q', '10-K']);
    assert.match(f[0].url, /sec\.gov\/Archives\/edgar\/data\/1045810\/0001242\/d8k\.htm/);
  });

  await t('Stooq CSV -> micro-dollar quote and price stats', async () => {
    const q = await md.getQuote('NVDA');
    assert.equal(q.source, 'stooq');
    assert.equal(typeof q.priceMicro, 'bigint');
    const s = await md.getPriceStats('NVDA');
    assert.ok(s.last > s.low52 && s.high52 >= s.last);
  });

  await t('news RSS parsed, entities decoded, dates normalised', async () => {
    const news = await md.getNews('nvda test');
    assert.equal(news.length, 2);
    assert.equal(news[0].title, 'Chip maker beats estimates & raises outlook');
    assert.equal(news[0].publishedAt, '2024-03-20');
  });

  await t('full pipeline with a faithful LLM answer keeps it and scores high', async () => {
    llmReply = {
      overview: 'NVIDIA Corp (NVDA) reported annual revenue of $60.92B for the fiscal year ended 2024-01-28.',
      developments: ['Headline: Chip maker beats estimates & raises outlook.'],
      bullishFactors: ['Revenue growth of 125.9% versus the prior fiscal year.'],
      bearishFactors: ['Regulators are looking at AI chip exports according to a headline.'],
      risks: ['Export rules could change.'],
      conclusion: 'Strong reported growth, with regulatory headlines to monitor.',
    };
    const out = await research.run({ task_type: 'company_research', target: 'NVDA' });
    assert.equal(out.company.ticker, 'NVDA');
    assert.equal(out.report.financialSummary.revenue, 60922000000);
    assert.equal(out.report.financialSummary.revenueGrowthPct, 125.9);
    assert.ok(out.sources.some((s) => /sec\.gov/.test(s.url)));
    assert.ok(out.sources.every((s) => s.retrievedAt));
    assert.ok(out.quality >= 85, 'quality ' + out.quality);
    assert.match(out.report.interpretation.generator, /llm:test-model/);
    assert.deepEqual(out.report.qualityFlags, []);
    assert.match(out.report.disclaimer, /not financial advice/i);
  });

  await t('numeric guard strips figures the LLM invented', async () => {
    llmReply = {
      overview: 'NVIDIA made $99.99 billion in revenue last year and will hit $5,000 per share.',
      developments: ['Headline: Chip maker beats estimates & raises outlook.'],
      bullishFactors: ['Revenue grew 300% year over year.', 'Revenue growth of 125.9% versus the prior fiscal year.'],
      bearishFactors: ['Regulators are looking at AI chip exports according to a headline.'],
      risks: ['Export rules could change.'],
      conclusion: 'Neutral.',
    };
    const out = await research.run({ task_type: 'company_research', target: 'NVDA' });
    assert.ok(!/99\.99|5,000/.test(out.report.overview), 'fabricated overview must be replaced');
    assert.ok(out.report.bullishFactors.every((x) => !/300%/.test(x)), 'fabricated bullet removed');
    assert.ok(out.report.bullishFactors.some((x) => /125\.9/.test(x)), 'faithful bullet kept');
    assert.ok(out.report.qualityFlags.some((f) => /unverified figure/i.test(f)));
  });

  await t('garbage LLM output falls back to the rule-based report', async () => {
    llmReply = { nonsense: true };
    const out = await research.run({ task_type: 'company_research', target: 'NVDA' });
    assert.equal(out.report.interpretation.generator, 'rules');
    assert.ok(out.report.overview.includes('60.92B'));
  });

  await t('market summary and industry tasks work without a company', async () => {
    llmReply = { nonsense: true };
    const m = await research.run({ task_type: 'market_summary', target: 'US market' });
    assert.equal(m.company.ticker, 'MARKET');
    assert.ok(m.report.marketData.length === 3);
    const i = await research.run({ task_type: 'industry_analysis', target: 'semiconductor' });
    assert.equal(i.company.ticker, 'INDUSTRY');
    assert.ok(i.report.missingData.some((x) => /not applicable/i.test(x)));
  });

  await t('unknown company fails clearly (no made-up report)', async () => {
    await assert.rejects(() => research.run({ task_type: 'company_research', target: 'zzzz-not-real' }), /Could not identify/);
  });

  console.log(`\n${n} provider/research tests passed`);
  process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e.message, '\n', e.stack); process.exit(1); });
