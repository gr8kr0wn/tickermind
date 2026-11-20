// Free data providers behind one interface so any can be swapped:
//  - SEC EDGAR (company facts, filings)  - Stooq (daily prices)  - Google News RSS (headlines)
const cfg = require('./config');
const { fetchJson, fetchText, ttlCache } = require('./util');
const { parseUnits, ONE } = require('./money');

const short = ttlCache(10 * 60 * 1000);
const long = ttlCache(24 * 60 * 60 * 1000);
const secHeaders = () => ({ 'User-Agent': cfg.secUserAgent, Accept: 'application/json' });

const FALLBACK = {
  NVDA: ['NVIDIA Corp', 1045810], AAPL: ['Apple Inc.', 320193], MSFT: ['Microsoft Corp', 789019],
  TSLA: ['Tesla, Inc.', 1318605], AMZN: ['Amazon.com, Inc.', 1018724], GOOGL: ['Alphabet Inc.', 1652044],
  META: ['Meta Platforms, Inc.', 1326801], AMD: ['Advanced Micro Devices', 2488], NFLX: ['Netflix, Inc.', 1065280],
  INTC: ['Intel Corp', 50863], JPM: ['JPMorgan Chase & Co', 19617],
};

async function secTickers() {
  const hit = long.get('tickers');
  if (hit) return hit;
  const j = await fetchJson('https://www.sec.gov/files/company_tickers.json', { headers: secHeaders() }, 15000);
  return long.set('tickers', Object.values(j));
}

// -> { name, ticker, cik|null } or null
async function resolveCompany(query) {
  const q = String(query).trim();
  const up = q.toUpperCase();
  try {
    const list = await secTickers();
    let m = list.find((x) => x.ticker === up);
    if (!m) {
      const lq = q.toLowerCase();
      m = list.find((x) => x.title.toLowerCase() === lq) || list.find((x) => x.title.toLowerCase().includes(lq));
    }
    if (m) return { name: m.title, ticker: m.ticker, cik: m.cik_str };
    return null;
  } catch (_) {
    if (FALLBACK[up]) return { name: FALLBACK[up][0], ticker: up, cik: FALLBACK[up][1] };
    return null;
  }
}

const pad = (cik) => String(cik).padStart(10, '0');
const REV_TAGS = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'];
const days = (a, b) => (new Date(b) - new Date(a)) / 86400000;

async function annualConcept(cik, tags) {
  for (const tag of tags) {
    try {
      const j = await fetchJson(`https://data.sec.gov/api/xbrl/companyconcept/CIK${pad(cik)}/us-gaap/${tag}.json`, { headers: secHeaders() });
      const rows = (j.units?.USD || []).filter((r) => r.fp === 'FY' && r.form === '10-K' && r.start && days(r.start, r.end) > 340 && days(r.start, r.end) < 390);
      if (!rows.length) continue;
      rows.sort((a, b) => (a.end < b.end ? 1 : -1));
      const latest = rows[0];
      const prior = rows.find((r) => days(r.end, latest.end) > 330 && days(r.end, latest.end) < 400);
      return { tag, value: latest.val, end: latest.end, filed: latest.filed, accn: latest.accn, prior: prior ? prior.val : null };
    } catch (_) {
      /* try next tag */
    }
  }
  return null;
}

async function getFinancials(cik) {
  const key = 'fin:' + cik;
  const hit = short.get(key);
  if (hit) return hit;
  const [revenue, netIncome] = await Promise.all([annualConcept(cik, REV_TAGS), annualConcept(cik, ['NetIncomeLoss'])]);
  return short.set(key, { revenue, netIncome });
}

async function getFilings(cik, ticker) {
  const key = 'fil:' + cik;
  const hit = short.get(key);
  if (hit) return hit;
  try {
    const j = await fetchJson(`https://data.sec.gov/submissions/CIK${pad(cik)}.json`, { headers: secHeaders() });
    const r = j.filings.recent;
    const out = [];
    for (let i = 0; i < r.form.length && out.length < 4; i++) {
      if (!['10-K', '10-Q', '8-K'].includes(r.form[i])) continue;
      out.push({
        title: `${ticker} ${r.form[i]} filed ${r.filingDate[i]} (SEC EDGAR)`,
        url: `https://www.sec.gov/Archives/edgar/data/${cik}/${r.accessionNumber[i].replace(/-/g, '')}/${r.primaryDocument[i]}`,
        publishedAt: r.filingDate[i],
        form: r.form[i],
      });
    }
    return short.set(key, out);
  } catch (_) {
    return [];
  }
}

// ---------- prices (Stooq) ----------
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2 || !/^Date,/i.test(lines[0])) return null;
  return lines.slice(1).map((l) => {
    const [date, , , , close] = l.split(',');
    return { date, close };
  }).filter((r) => r.date && r.close && !isNaN(Number(r.close)));
}

async function history(ticker) {
  const key = 'hist:' + ticker;
  const hit = short.get(key);
  if (hit !== undefined) return hit;
  const sym = ticker.toLowerCase().replace(/\./g, '-') + '.us';
  const text = await fetchText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`, {}, 12000); // throws on network error
  const rows = parseCsv(text);
  return short.set(key, rows && rows.length ? rows : null); // null = "provider has no data for this symbol"
}

function toMicro(closeStr) {
  const [w, f = ''] = String(Number(closeStr)).split('.');
  return parseUnits(w + (f ? '.' + f.slice(0, 6) : ''));
}

function syntheticMicro(ticker) {
  let h = 0;
  for (const ch of ticker) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const base = 40 + (h % 360);
  const day = Math.floor(Date.now() / 86400000);
  const drift = 1 + 0.06 * Math.sin(day / 9 + (h % 7));
  return BigInt(Math.round(base * drift * 1e6));
}

// -> { priceMicro, asOf, source } | null (symbol unknown to provider)
async function getQuote(ticker) {
  try {
    const rows = await history(ticker);
    if (!rows) return null;
    const last = rows[rows.length - 1];
    return { priceMicro: toMicro(last.close), asOf: last.date, source: 'stooq' };
  } catch (_) {
    return { priceMicro: syntheticMicro(ticker), asOf: new Date().toISOString().slice(0, 10), source: 'synthetic' };
  }
}

// display stats for reports (floats are fine here; never used for balances)
async function getPriceStats(ticker) {
  try {
    const rows = await history(ticker);
    if (!rows || rows.length < 30) return null;
    const closes = rows.map((r) => Number(r.close));
    const last = closes[closes.length - 1];
    const yr = closes.slice(-252);
    const back = (n) => closes[Math.max(0, closes.length - 1 - n)];
    return {
      asOf: rows[rows.length - 1].date,
      last,
      high52: Math.max(...yr),
      low52: Math.min(...yr),
      ret3mPct: +(((last / back(63)) - 1) * 100).toFixed(1),
      ret1yPct: +(((last / back(252)) - 1) * 100).toFixed(1),
      source: 'Stooq daily closes',
    };
  } catch (_) {
    return null;
  }
}

// ---------- news (Google News RSS headlines) ----------
const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function getNews(query, max = 6) {
  const key = 'news:' + query;
  const hit = short.get(key);
  if (hit) return hit;
  try {
    const xml = await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`, {}, 12000);
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, max).map((m) => {
      const g = (t) => (m[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1];
      return { title: decode(g('title') || ''), url: decode(g('link') || ''), publishedAt: g('pubDate') ? new Date(g('pubDate')).toISOString().slice(0, 10) : undefined };
    }).filter((i) => i.title && i.url);
    return short.set(key, items);
  } catch (_) {
    return [];
  }
}

module.exports = { resolveCompany, getFinancials, getFilings, getQuote, getPriceStats, getNews, ONE };
