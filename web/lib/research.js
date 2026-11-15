// The research engine: gather sourced facts → ask the LLM to interpret ONLY those facts → assemble a hashed report.
import { fetchFinnhub, fetchEdgar, filingUrl } from './market-data.js';
import { generateJson } from './llm.js';
import { hashReport } from './hash.js';
import { bad } from './http.js';

const money = (v, cur = 'USD') => {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  const abs = Math.abs(n);
  const sym = cur === 'USD' ? '$' : `${cur} `;
  if (abs >= 1e12) return `${sym}${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sym}${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sym}${(n / 1e6).toFixed(1)}M`;
  return `${sym}${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
};
const pct = (v, digits = 1) => (v == null || !Number.isFinite(Number(v)) ? null : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(digits)}%`);
const num = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v).toFixed(d));

export const STRATEGIES = {
  long_term: 'long-term fundamental company analysis',
  earnings: 'earnings quality and quarter-over-quarter momentum',
  dividends: 'dividend sustainability and cash generation',
  market_intel: 'market and industry intelligence',
};

function buildFacts(ticker, fh, edgar) {
  const facts = [];
  const retrieved = new Date().toISOString();
  const add = (label, value, detail, source) => {
    if (value == null) return;
    facts.push({ id: `f${facts.length + 1}`, label, value, detail: detail || null, source: { ...source, retrieved } });
  };
  const cur = fh.profile?.currency || 'USD';
  const FH = (ref) => ({ name: 'Finnhub', ref, url: `https://finnhub.io/` });

  if (fh.quote) {
    add('Last price', money(fh.quote.c, cur), `${fh.quote.dp != null ? `${pct(fh.quote.dp, 2)} today · ` : ''}prev close ${money(fh.quote.pc, cur)}`, FH('quote'));
  }
  if (fh.profile?.marketCapitalization) add('Market capitalization', money(fh.profile.marketCapitalization * 1e6, cur), null, FH('profile'));
  const m = fh.metric || {};
  if (m['52WeekHigh'] && m['52WeekLow']) add('52-week range', `${money(m['52WeekLow'], cur)} – ${money(m['52WeekHigh'], cur)}`, null, FH('basic financials'));
  add('P/E (TTM)', num(m.peTTM ?? m.peBasicExclExtraTTM, 1), null, FH('basic financials'));
  add('EPS (TTM)', m.epsTTM != null ? money(m.epsTTM, cur) : null, null, FH('basic financials'));
  add('Revenue growth (TTM, YoY)', pct(m.revenueGrowthTTMYoy), null, FH('basic financials'));
  add('Gross margin (TTM)', m.grossMarginTTM != null ? `${num(m.grossMarginTTM, 1)}%` : null, null, FH('basic financials'));
  add('Net margin (TTM)', m.netProfitMarginTTM != null ? `${num(m.netProfitMarginTTM, 1)}%` : null, null, FH('basic financials'));
  add('Dividend yield', m.dividendYieldIndicatedAnnual != null ? `${num(m.dividendYieldIndicatedAnnual, 2)}%` : null, null, FH('basic financials'));
  add('Beta', num(m.beta, 2), null, FH('basic financials'));

  const e = fh.earnings?.[0];
  if (e && e.actual != null) {
    add(`EPS ${e.period}`, money(e.actual, cur), e.estimate != null ? `vs estimate ${money(e.estimate, cur)} (${pct(e.surprisePercent)} surprise)` : null, FH('earnings'));
  }
  const r = fh.recommendation;
  if (r) {
    const total = (r.strongBuy || 0) + (r.buy || 0) + (r.hold || 0) + (r.sell || 0) + (r.strongSell || 0);
    if (total) add('Analyst ratings', `${(r.strongBuy || 0) + (r.buy || 0)} buy · ${r.hold || 0} hold · ${(r.sell || 0) + (r.strongSell || 0)} sell`, `${total} analysts, ${r.period}`, FH('recommendation trends'));
  }

  if (edgar?.items) {
    const it = edgar.items;
    const sec = (row) => ({ name: 'SEC EDGAR', ref: row.form, url: filingUrl(edgar.cik, row.accn), filed: row.filed });
    const quarterly = (key, label, isEps) => {
      const x = it[key];
      if (!x?.latest) return;
      const v = x.latest.val;
      const yoy = x.yearAgo?.val ? ((v - x.yearAgo.val) / Math.abs(x.yearAgo.val)) * 100 : null;
      add(`${label} (quarter ended ${x.latest.end})`, isEps ? money(v) : money(v), yoy != null ? `${pct(yoy)} vs same quarter last year` : null, sec(x.latest));
    };
    quarterly('revenue', 'Revenue');
    quarterly('operatingIncome', 'Operating income');
    quarterly('netIncome', 'Net income');
    quarterly('epsDiluted', 'Diluted EPS', true);
    if (it.annualRevenue?.latest) add(`Annual revenue (FY ended ${it.annualRevenue.latest.end})`, money(it.annualRevenue.latest.val), null, sec(it.annualRevenue.latest));
    if (it.cash?.latest) add(`Cash & equivalents (${it.cash.latest.end})`, money(it.cash.latest.val), null, sec(it.cash.latest));
  }
  return facts;
}

const SYSTEM = `You are a financial research analyst agent on TickerMind.
You write clear, balanced equity research for retail readers. You are not giving financial advice.
STRICT RULES:
- Use ONLY the facts and news provided. Never invent numbers, dates, products or quotes.
- When you mention a number, it must appear in the facts; cite it like [f3].
- Clearly separate interpretation from fact. Keep sentences short and plain.
- Reply with JSON only, matching the requested shape exactly.`;

function buildPrompt(agent, ticker, fh, facts, news) {
  return `Agent: ${agent.name}. Specialization: ${STRATEGIES[agent.strategy] || STRATEGIES.long_term}. Sector focus: ${agent.sector}.
Company: ${fh.profile?.name || ticker} (${ticker}), industry: ${fh.profile?.finnhubIndustry || 'unknown'}, exchange: ${fh.profile?.exchange || 'unknown'}.

FACTS (verified, with ids):
${facts.map((f) => `[${f.id}] ${f.label}: ${f.value}${f.detail ? ` (${f.detail})` : ''} — source: ${f.source.name} ${f.source.ref}`).join('\n')}

RECENT NEWS HEADLINES (last 14 days; headlines only, treat as context not as verified fact):
${news.length ? news.map((n, i) => `[n${i + 1}] ${n.date} · ${n.source}: ${n.headline}`).join('\n') : '(none)'}

Return JSON with exactly these keys:
{
  "overview": "2-3 sentences: what the company does and where it stands now",
  "revenue_analysis": "2-4 sentences on revenue, earnings and margins, citing fact ids",
  "industry": "2-3 sentences on industry developments, using the news headlines where relevant (cite [nX])",
  "risks": ["3 to 5 short risk statements"],
  "bull": ["3 short bullish arguments"],
  "bear": ["3 short bearish arguments"],
  "bull_score": 0-100 integer (50 = balanced; higher = more bullish on the evidence),
  "conclusion": "2-3 sentence AI conclusion, clearly framed as interpretation, not advice"
}`;
}

/** Runs the full pipeline and returns { content, hash, model, title }. */
export async function runResearch(agent, ticker) {
  const [fh, edgar] = await Promise.all([fetchFinnhub(ticker), fetchEdgar(ticker)]);
  if (!fh.profile && !fh.quote && !edgar?.entity) throw bad(`Couldn't find market data for ${ticker}. Check the ticker symbol (US-listed stocks work best).`);

  const facts = buildFacts(ticker, fh, edgar);
  if (facts.length < 3) throw bad(`Not enough verified data for ${ticker} to write a reliable report.`);

  const news = (fh.news || []).filter((n) => n.headline).slice(0, 6).map((n) => ({
    headline: n.headline,
    source: n.source,
    url: n.url,
    date: new Date(n.datetime * 1000).toISOString().slice(0, 10),
  }));

  const { json, model } = await generateJson(SYSTEM, buildPrompt(agent, ticker, fh, facts, news));
  const list = (x, n) => (Array.isArray(x) ? x.map(String).filter(Boolean).slice(0, n) : []);
  const analysis = {
    overview: String(json.overview || ''),
    revenue_analysis: String(json.revenue_analysis || ''),
    industry: String(json.industry || ''),
    risks: list(json.risks, 5),
    bull: list(json.bull, 3),
    bear: list(json.bear, 3),
    bull_score: Math.max(0, Math.min(100, Math.round(Number(json.bull_score) || 50))),
    conclusion: String(json.conclusion || ''),
  };
  if (!analysis.overview || !analysis.conclusion) throw new Error('AI returned an incomplete report. Try again.');

  const sources = [];
  const seen = new Set();
  for (const f of facts) {
    const key = f.source.url;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({ name: `${f.source.name}${f.source.ref ? ` · ${f.source.ref}` : ''}`, url: f.source.url });
  }
  news.forEach((n) => sources.push({ name: `${n.source} · news`, url: n.url }));

  const company = {
    name: fh.profile?.name || edgar?.entity || ticker,
    exchange: fh.profile?.exchange || null,
    industry: fh.profile?.finnhubIndustry || null,
    country: fh.profile?.country || null,
    currency: fh.profile?.currency || 'USD',
    website: fh.profile?.weburl || null,
    cik: edgar?.cik || null,
  };

  const content = {
    version: 1,
    ticker,
    company,
    agent: { id: agent.id, name: agent.name, onchainId: agent.onchain_id },
    strategy: agent.strategy,
    generatedAt: new Date().toISOString(),
    facts,
    news,
    analysis,
    sources,
    disclaimer: 'Generated by an AI agent from public data. Facts link to their sources; analysis is AI interpretation. Not financial advice.',
  };
  return { content, hash: hashReport(content), model, title: `${company.name} (${ticker}) research brief` };
}

/** Quality gate used before releasing escrowed payment. */
export function passesQualityGate(content) {
  const sourced = content.facts.filter((f) => f.source?.url).length;
  return sourced >= 4 && content.analysis.bull.length > 0 && content.analysis.bear.length > 0;
}
