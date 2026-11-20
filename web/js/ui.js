// UI toolkit: auto-escaping html`` templates, icons, generative avatars, rings, donuts, formatters.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => ({ __raw: String(s) });
const str = (v) => (v === null || v === undefined || v === false ? '' : v.__raw !== undefined ? v.__raw : Array.isArray(v) ? v.map(str).join('') : esc(v));
// Every interpolated value is HTML-escaped unless it is itself an html`` fragment.
export const html = (s, ...v) => raw(s.reduce((o, p, i) => o + p + (i < v.length ? str(v[i]) : ''), ''));
export const mount = (el, frag) => { el.innerHTML = frag.__raw; return el; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function delegate(root, event, sel, fn) {
  root.addEventListener(event, (e) => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); });
}

const P = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  bot: 'M5 8h14a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a2 2 0 012-2zM12 8V4M9 13v1.5M15 13v1.5',
  store: 'M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9a2.7 2.7 0 005.3 0 2.7 2.7 0 005.4 0A2.7 2.7 0 0020 9M10 20v-5h4v5',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  trophy: 'M8 4h8v6a4 4 0 01-8 0zM8 6H4v2a3 3 0 003 3M16 6h4v2a3 3 0 01-3 3M12 14v4M8 21h8',
  wallet: 'M4 7h15a1 1 0 011 1v11a1 1 0 01-1 1H5a2 2 0 01-2-2V6a2 2 0 012-2h12M16 14h.01',
  plus: 'M12 5v14M5 12h14', bolt: 'M13 2L4 14h7l-1 8 9-12h-7z', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
  coin: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v10M9.5 9.5h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2', check: 'M5 12l5 5L20 7',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3', chart: 'M4 20V4M4 20h16M8 15l3-4 3 2 5-7',
  pause: 'M8 5v14M16 5v14', play: 'M7 4l13 8-13 8z',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  chip: 'M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
  heart: 'M12 20s-8-5-8-11a4.5 4.5 0 018-2.5A4.5 4.5 0 0120 9c0 6-8 11-8 11z',
  flame: 'M12 3s5 4 5 9a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 0-5 1-8z',
  bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  refresh: 'M20 11a8 8 0 00-14-4L4 9M4 4v5h5M4 13a8 8 0 0014 4l2-2M20 20v-5h-5',
  send: 'M21 3L3 11l7 3 3 7z', x: 'M6 6l12 12M18 6L6 18', logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4', users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 3-5 6-5s6 2 6 5M17 11a3 3 0 100-6M21 20c0-2-1.5-3.5-3.5-4.5',
  spark: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z', warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5', pie: 'M12 3a9 9 0 109 9h-9z', trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  news: 'M5 4h12a2 2 0 012 2v14H7a2 2 0 01-2-2zM9 8h6M9 12h6M9 16h4', external: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5',
};
export const ic = (n, cls = '') => raw(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n] || P.spark}"/></svg>`);

export const SPECS = {
  technology: { label: 'Tech', icon: 'chip', targets: ['NVDA', 'AAPL', 'MSFT', 'AMD'] },
  healthcare: { label: 'Health', icon: 'heart', targets: ['LLY', 'PFE', 'MRNA'] },
  energy: { label: 'Energy', icon: 'flame', targets: ['XOM', 'CVX'] },
  finance: { label: 'Finance', icon: 'bank', targets: ['JPM', 'GS'] },
  general: { label: 'General', icon: 'globe', targets: ['SPY', 'QQQ'] },
};
export const PERMS = [
  ['readMarketData', 'Read market data', 'eye'], ['generateReports', 'Write reports', 'doc'], ['publishReports', 'Publish reports', 'send'],
  ['acceptTasks', 'Take orders', 'bolt'], ['receivePayments', 'Get paid', 'coin'], ['simulateAllocations', 'Practice portfolio', 'pie'],
  ['requestServices', 'Hire other agents', 'users'],
];

// generative avatar: gradient + one of 6 patterns, 12 looks
const HUES = [75, 160, 190, 215, 260, 300, 335, 10, 35, 50, 120, 240];
export function avatar(idx = 0, size = 48) {
  idx = ((Number(idx) || 0) % 12 + 12) % 12;
  const h = HUES[idx], k = idx % 6, w = 'rgba(255,255,255,.88)';
  const shapes = [
    `<circle cx="32" cy="32" r="8" fill="none" stroke="${w}" stroke-width="3"/><circle cx="32" cy="32" r="17" fill="none" stroke="${w}" stroke-width="3" opacity=".6"/><circle cx="32" cy="32" r="26" fill="none" stroke="${w}" stroke-width="3" opacity=".3"/>`,
    [14, 26, 38, 50].map((x, i) => `<rect x="${x - 4}" y="${[34, 22, 28, 14][i]}" width="8" height="${[16, 30, 20, 36][i]}" rx="2" fill="${w}"/><path d="M${x} ${[28, 14, 22, 8][i]}v${[28, 44, 34, 50][i] - [28, 14, 22, 8][i]}" stroke="${w}" stroke-width="2"/>`).join(''),
    Array.from({ length: 16 }, (_, i) => `<circle cx="${14 + (i % 4) * 12}" cy="${14 + Math.floor(i / 4) * 12}" r="${2 + ((i * 7) % 4)}" fill="${w}"/>`).join(''),
    Array.from({ length: 6 }, (_, i) => `<path d="M${-10 + i * 16} 70L${24 + i * 16} -6" stroke="${w}" stroke-width="4" opacity="${i % 2 ? 0.45 : 0.9}"/>`).join(''),
    `<path d="M32 8l20 24-20 24L12 32z" fill="none" stroke="${w}" stroke-width="3"/><path d="M32 20l10 12-10 12-10-12z" fill="${w}"/>`,
    `<path d="M6 40c8-18 14-18 20 0s12 18 20 0 10-14 12-8" fill="none" stroke="${w}" stroke-width="4" stroke-linecap="round"/><path d="M6 26c8-12 14-12 20 0" fill="none" stroke="${w}" stroke-width="3" opacity=".5" stroke-linecap="round"/>`,
  ][k];
  return raw(`<span class="av" style="width:${size}px;height:${size}px;background:linear-gradient(140deg,hsl(${h} 70% 52%),hsl(${(h + 45) % 360} 65% 24%))"><svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">${shapes}</svg></span>`);
}

export function ring(value, size = 44) {
  const has = value !== null && value !== undefined;
  const r = (size - 6) / 2, c = 2 * Math.PI * r, v = has ? Math.max(0, Math.min(100, value)) : 0;
  const col = !has ? '#5d676f' : v >= 75 ? 'var(--volt)' : v >= 50 ? 'var(--amber)' : 'var(--loss)';
  return raw(`<span class="ring-wrap" style="width:${size}px;height:${size}px" title="Research quality"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="4"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(c * v) / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg><span class="v">${has ? v : '–'}</span></span>`);
}

export function donut(parts, size = 150, th = 18) {
  const r = (size - th) / 2, c = 2 * Math.PI * r, total = parts.reduce((a, p) => a + p.value, 0);
  let off = 0;
  const arcs = total > 0 ? parts.filter((p) => p.value > 0).map((p) => {
    const len = (p.value / total) * c;
    const s = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${th}" stroke-dasharray="${Math.max(0, len - 2)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
    off += len;
    return s;
  }).join('') : '';
  return raw(`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="${th}"/>${arcs}</svg>`);
}

// ---------- formatters (money is BigInt micro-USDC; never floats) ----------
export function usd(micro, dp = 2) {
  let n; try { n = BigInt(micro ?? 0); } catch { n = 0n; }
  const neg = n < 0n; if (neg) n = -n;
  const whole = (n / 1000000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (n % 1000000n).toString().padStart(6, '0').slice(0, dp);
  return (neg ? '-' : '') + whole + (dp ? '.' + frac : '');
}
export const money = (micro, dp = 2) => html`<span class="mono">${usd(micro, dp)}</span>`;
export const bps = (b) => { const n = Number(b) / 100; return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; };
export const bpsCls = (b) => (Number(b) > 0 ? 'up' : Number(b) < 0 ? 'down' : 'mute');
export const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');
export function ago(iso) {
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago';
}
export const big = (n) => { if (n == null) return '–'; const a = Math.abs(n); const s = a >= 1e12 ? (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a.toLocaleString('en-US'); return (n < 0 ? '-$' : '$') + s; };

export const statusDot = (s) => html`<span class="dot ${s}" title="${s}"></span>`;
export const chip = (t, kind = '') => html`<span class="chip ${kind}">${t}</span>`;
export const simChip = () => html`<span class="chip amber" title="Practice money on a test network. Not real funds.">${ic('warn')} Simulated</span>`;
export const empty = (icon, title, sub = '', action = '') => html`<div class="empty glass"><div class="ico">${ic(icon, '')}</div><h3>${title}</h3><p class="sm">${sub}</p>${action}</div>`;
export const skeleton = (n = 3) => html`<div class="grid auto">${Array.from({ length: n }, () => raw('<div class="skel"></div>'))}</div>`;

// ---------- toast + modal ----------
export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 6500 : 3800);
}
export function openModal(frag, onMount) {
  const m = $('#modal');
  mount(m, html`<div class="sheet glass" role="dialog" aria-modal="true" style="position:relative"><button class="btn sm x" data-close aria-label="Close">${ic('x')}</button>${frag}</div>`);
  m.hidden = false;
  const close = () => { m.hidden = true; m.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  m.onclick = (e) => { if (e.target === m || e.target.closest('[data-close]')) close(); };
  if (onMount) onMount($('.sheet', m), close);
  return close;
}

// polling helper: resolves when done(result) is true or after maxMs
export async function poll(fn, done, { every = 2000, maxMs = 120000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const r = await fn();
    if (done(r) || Date.now() - t0 > maxMs) return r;
    await new Promise((res) => setTimeout(res, every));
  }
}
export const busy = async (btn, fn) => {
  const label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = label; }
};
