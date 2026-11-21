// Free data providers behind one interface so any can be swapped:
//  - SEC EDGAR (company facts, filings)  - Stooq / Yahoo Finance (daily prices)  - Google News + Yahoo RSS (headlines)
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
  // Companies switch XBRL tags over time (NVIDIA moved from one revenue tag to another), so a tag can exist
  // but be years stale. Check every tag and keep the one whose latest fiscal year ends last.
  const found = [];
  await Promise.all(tags.map(async (tag) => {
    try {
      const j = await fetchJson(`https://data.sec.gov/api/xbrl/companyconcept/CIK${pad(cik)}/us-gaap/${tag}.json`, { headers: secHeaders() });
      const rows = (j.units?.USD || []).filter((r) => r.fp === 'FY' && r.form === '10-K' && r.start && days(r.start, r.end) > 340 && days(r.start, r.end) < 390);
      if (!rows.length) return;
      rows.sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : a.filed < b.filed ? 1 : -1)); // newest year, then newest filing (restatements)
      const latest = rows[0];
      const prior = rows.find((r) => days(r.end, latest.end) > 330 && days(r.end, latest.end) < 400);
      found.push({ order: tags.indexOf(tag), tag, value: latest.val, end: latest.end, filed: latest.filed, accn: latest.accn, prior: prior ? prior.val : null });
    } catch (e) {
      if (!/HTTP 404/.test(e.message)) console.warn('[sec] concept', tag, e.message);
    }
  }));
  if (!found.length) return null;
  found.sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : a.order - b.order));
  const { order, ...best } = found[0];
  return best;
}

async function getFinancials(cik) {
  const key = 'fin:' + cik;
  const hit = short.get(key);
  if (hit) return hit;
  const [revenue, netIncome] = await Promise.all([annualConcept(cik, REV_TAGS), annualConcept(cik, ['NetIncomeLoss'])]);
  // revenue and net income must describe the same fiscal year, otherwise margins and comparisons are meaningless
  const misaligned = !!(revenue && netIncome && Math.abs(days(revenue.end, netIncome.end)) > 45);
  return short.set(key, { revenue, netIncome, misaligned });
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

// ---------- prices (Stooq with a free key, otherwise Yahoo Finance) ----------
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2 || !/^Date,/i.test(lines[0])) return null;
  return lines.slice(1).map((l) => {
    const [date, , , , close] = l.split(',');
    return { date, close };
  }).filter((r) => r.date && r.close && !isNaN(Number(r.close)));
}

async function stooqRows(ticker, key) {
  const sym = ticker.toLowerCase().replace(/\./g, '-') + '.us';
  const text = await fetchText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d&apikey=${encodeURIComponent(key)}`, {}, 12000);
  const rows = parseCsv(text); // an HTML "get your apikey" page parses to null
  return rows && rows.length ? rows : null;
}

async function yahooRows(ticker) {
  const sym = ticker.toUpperCase().replace(/\./g, '-');
  const text = await fetchText(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d`, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } }, 12000);
  const r = JSON.parse(text).chart?.result?.[0];
  if (!r || !r.timestamp) return null;
  const closes = r.indicators?.quote?.[0]?.close || [];
  const rows = [];
  r.timestamp.forEach((ts, i) => {
    const c = closes[i];
    if (c !== null && c !== undefined && isFinite(c)) rows.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: String(c) });
  });
  return rows.length ? rows : null;
}

// -> { rows, provider, url } | null (no provider knows the symbol). Throws only when every provider is unreachable.
async function history(ticker) {
  const key = 'hist:' + ticker;
  const hit = short.get(key);
  if (hit !== undefined) return hit;
  let result = null;
  let lastErr = null;
  if (process.env.STOOQ_API_KEY) {
    try {
      const rows = await stooqRows(ticker, process.env.STOOQ_API_KEY);
      if (rows) result = { rows, provider: 'Stooq', url: `https://stooq.com/q/?s=${ticker.toLowerCase()}.us` };
    } catch (e) {
      lastErr = e;
      console.warn('[prices] stooq', ticker, e.message);
    }
  }
  if (!result) {
    try {
      const rows = await yahooRows(ticker);
      if (rows) result = { rows, provider: 'Yahoo Finance', url: `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/history` };
      else lastErr = null;
    } catch (e) {
      lastErr = e;
      console.warn('[prices] yahoo', ticker, e.message);
    }
  }
  if (!result && lastErr) throw lastErr;
  return short.set(key, result); // null = "no provider has data for this symbol"
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
    const h = await history(ticker);
    if (!h) return null;
    const last = h.rows[h.rows.length - 1];
    return { priceMicro: toMicro(last.close), asOf: last.date, source: h.provider === 'Stooq' ? 'stooq' : 'yahoo' };
  } catch (_) {
    return { priceMicro: syntheticMicro(ticker), asOf: new Date().toISOString().slice(0, 10), source: 'synthetic' };
  }
}

// display stats for reports (floats are fine here; never used for balances)
async function getPriceStats(ticker) {
  try {
    const h = await history(ticker);
    if (!h || h.rows.length < 30) return null;
    const rows = h.rows;
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
      source: `${h.provider} daily closes`,
      provider: h.provider,
      url: h.url,
    };
  } catch (_) {
    return null;
  }
}

// ---------- news (Google News RSS headlines) ----------
const decode = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function parseRss(xml, max) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, max).map((m) => {
    const g = (t) => (m[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1];
    return { title: decode(g('title') || ''), url: decode(g('link') || ''), publishedAt: g('pubDate') ? new Date(g('pubDate')).toISOString().slice(0, 10) : undefined };
  }).filter((i) => i.title && i.url);
}

async function getNews(query, max = 6, ticker = null) {
  const key = 'news:' + query;
  const hit = short.get(key);
  if (hit) return hit;
  let items = [];
  try {
    // the consent cookie stops Google from answering EU/datacenter requests with a cookie-consent page
    const xml = await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`, { headers: { 'User-Agent': BROWSER_UA, Cookie: 'CONSENT=YES+cb' } }, 12000);
    items = parseRss(xml, max);
  } catch (e) {
    console.warn('[news] google', e.message);
  }
  if (items.length < 2 && ticker) {
    try {
      const xml = await fetchText(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`, { headers: { 'User-Agent': BROWSER_UA } }, 12000);
      const y = parseRss(xml, max);
      if (y.length > items.length) items = y;
    } catch (e) {
      console.warn('[news] yahoo', e.message);
    }
  }
  return items.length ? short.set(key, items) : items; // never cache an empty result
}

module.exports = { resolveCompany, getFinancials, getFilings, getQuote, getPriceStats, getNews, ONE };
