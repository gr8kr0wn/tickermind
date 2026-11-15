// Free data sources: Finnhub (quotes, profile, metrics, earnings, news, analyst trends)
// and SEC EDGAR (official filings + XBRL company facts). Every number we keep carries its source.
import { env, need } from './env.js';

const FINNHUB = 'https://finnhub.io/api/v1';

async function getJson(url, headers = {}, { allow404 = false } = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  if (allow404 && res.status === 404) return null;
  if (res.status === 429) throw new Error('Market data rate limit hit. Wait a minute and try again.');
  if (!res.ok) throw new Error(`Data request failed (${res.status}) for ${new URL(url).hostname}`);
  return res.json();
}

const finnhub = (path, params = {}) => {
  const qs = new URLSearchParams({ ...params, token: need('FINNHUB_API_KEY') });
  return getJson(`${FINNHUB}${path}?${qs}`).catch((e) => {
    console.warn('finnhub', path, e.message);
    return null;
  });
};

const isoDay = (d) => d.toISOString().slice(0, 10);

export async function quote(ticker) {
  const q = await finnhub('/quote', { symbol: ticker });
  return q && q.c ? q : null;
}

export async function fetchFinnhub(ticker) {
  const to = new Date();
  const from = new Date(Date.now() - 14 * 864e5);
  const [profile, q, metric, earnings, news, recs] = await Promise.all([
    finnhub('/stock/profile2', { symbol: ticker }),
    finnhub('/quote', { symbol: ticker }),
    finnhub('/stock/metric', { symbol: ticker, metric: 'all' }),
    finnhub('/stock/earnings', { symbol: ticker }),
    finnhub('/company-news', { symbol: ticker, from: isoDay(from), to: isoDay(to) }),
    finnhub('/stock/recommendation', { symbol: ticker }),
  ]);
  return {
    profile: profile && profile.name ? profile : null,
    quote: q && q.c ? q : null,
    metric: metric?.metric || {},
    earnings: Array.isArray(earnings) ? earnings.slice(0, 4) : [],
    news: Array.isArray(news) ? news.slice(0, 8) : [],
    recommendation: Array.isArray(recs) && recs.length ? recs[0] : null,
  };
}

// ---------------------------------------------------------------- SEC EDGAR

let tickerMap; // cached per warm function instance
async function cikFor(ticker) {
  const headers = { 'User-Agent': env.secUserAgent };
  if (!tickerMap) {
    const data = await getJson('https://www.sec.gov/files/company_tickers.json', headers);
    tickerMap = new Map(Object.values(data).map((r) => [String(r.ticker).toUpperCase(), String(r.cik_str)]));
  }
  return tickerMap.get(ticker.replace('.', '-')) || tickerMap.get(ticker) || null;
}

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

/** Picks the most recent quarterly value of a concept, plus the same quarter a year earlier. */
function latestQuarter(facts, concepts, unit = 'USD') {
  for (const concept of concepts) {
    const rows = facts?.[concept]?.units?.[unit];
    if (!rows?.length) continue;
    const q = rows.filter((r) => r.start && r.end && ['10-Q', '10-K'].includes(r.form) && Math.abs(days(r.start, r.end) - 91) < 12);
    if (!q.length) continue;
    const byEnd = new Map();
    for (const r of q) {
      const prev = byEnd.get(r.end);
      if (!prev || r.filed > prev.filed) byEnd.set(r.end, r);
    }
    const sorted = [...byEnd.values()].sort((a, b) => b.end.localeCompare(a.end));
    const latest = sorted[0];
    const yearAgo = sorted.find((r) => Math.abs(days(r.end, latest.end) - 365) < 20);
    return { concept, latest, yearAgo };
  }
  return null;
}

function latestAnnual(facts, concepts, unit = 'USD') {
  for (const concept of concepts) {
    const rows = facts?.[concept]?.units?.[unit];
    if (!rows?.length) continue;
    const a = rows.filter((r) => r.start && r.end && r.form === '10-K' && Math.abs(days(r.start, r.end) - 365) < 20);
    if (!a.length) continue;
    a.sort((x, y) => y.end.localeCompare(x.end) || y.filed.localeCompare(x.filed));
    return { concept, latest: a[0] };
  }
  return null;
}

export async function fetchEdgar(ticker) {
  try {
    const cik = await cikFor(ticker);
    if (!cik) return null;
    const padded = cik.padStart(10, '0');
    const headers = { 'User-Agent': env.secUserAgent };
    const data = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`, headers, { allow404: true });
    if (!data) return { cik, entity: null, items: {} };
    const g = data.facts?.['us-gaap'] || {};
    const items = {
      revenue: latestQuarter(g, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']),
      netIncome: latestQuarter(g, ['NetIncomeLoss']),
      operatingIncome: latestQuarter(g, ['OperatingIncomeLoss']),
      epsDiluted: latestQuarter(g, ['EarningsPerShareDiluted'], 'USD/shares'),
      annualRevenue: latestAnnual(g, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']),
      cash: (() => {
        const rows = g.CashAndCashEquivalentsAtCarryingValue?.units?.USD;
        if (!rows?.length) return null;
        const r = [...rows].filter((x) => ['10-Q', '10-K'].includes(x.form)).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0];
        return r ? { concept: 'CashAndCashEquivalentsAtCarryingValue', latest: r } : null;
      })(),
    };
    return { cik, entity: data.entityName, items };
  } catch (e) {
    console.warn('edgar', e.message);
    return null;
  }
}

export function filingUrl(cik, accn) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, '')}/${accn}-index.htm`;
}
