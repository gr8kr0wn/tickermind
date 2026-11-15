// UI helpers: escaping, formatting, identicons, icons, toasts, modals.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escape any untrusted text before putting it in HTML (AI output, names, etc.). */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Only allow http(s) links from external data. */
export const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '#');

export const qs = (k) => new URLSearchParams(location.search).get(k);

// ─── formatting
export const usd = (n, d = 2) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};
export const usdc = (n) => (n == null ? '—' : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC`);
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export const pad = (n) => `#${String(n ?? 0).padStart(4, '0')}`;
export const ago = (iso) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const SECTOR_LABEL = { technology: 'Technology', ai: 'AI', healthcare: 'Healthcare', energy: 'Energy', financials: 'Financials', general: 'General' };
export const STRATEGY_LABEL = { long_term: 'Long-term', earnings: 'Earnings', dividends: 'Dividends', market_intel: 'Market intel' };
export const FREQ_LABEL = { on_demand: 'On demand', daily: 'Daily', weekly: 'Weekly' };
export const SECTOR_ON = { technology: '#7FAEFF', ai: '#B3A8FF', healthcare: '#6FD6C0', energy: '#F8C46B', financials: '#EDEBE6', general: '#E8B98A' };

// ─── identicon: a 5×5 mirrored pattern unique to each agent name
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function identicon(name, color = '#7FAEFF', size = 64) {
  const h = hash(String(name || 'agent').toUpperCase());
  let cells = '';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const cc = c < 3 ? c : 4 - c;
    const on = (h >>> ((r * 3 + cc) % 30)) & 1;
    cells += `<i style="background:${on ? color : 'rgba(255,255,255,.07)'}"></i>`;
  }
  return `<div class="ident" style="width:${size}px" aria-hidden="true">${cells}</div>`;
}

// ─── icons (Lucide-style strokes)
const P = {
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
  tag: '<path d="M3 12l9-9h8v8l-9 9z"/><circle cx="15.5" cy="8.5" r="1"/>',
  coins: '<circle cx="9" cy="9" r="6"/><path d="M15.7 9.3a6 6 0 1 1-6.4 6.4"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.3A9 9 0 0 1 20.7 9H15z"/>',
  wallet: '<rect x="2" y="6" width="20" height="14" rx="3"/><path d="M2 10h20"/><path d="M16 15h2"/>',
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v11H4z"/><path d="M9 20v-6h6v6"/>',
  trophy: '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  ext: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  spark: '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  bank: '<path d="M3 21h18M5 21V10M9.5 21V10M14.5 21V10M19 21V10M2 10l10-7 10 7z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
};
export const SECTOR_ICON = { technology: 'monitor', ai: 'cpu', healthcare: 'pulse', energy: 'bolt', financials: 'bank', general: 'globe' };
export function icon(name, size = 18, stroke = 2) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

/** Replaces <span data-icon="name"> placeholders in static HTML with SVG icons. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 16); });
}

export const LOGO = `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><line x1="4" y1="5" x2="4" y2="23" stroke="#0052FF" stroke-width="1.5"/><rect x="2" y="9" width="4" height="10" rx="1" fill="#0052FF"/><line x1="13" y1="2" x2="13" y2="19" stroke="#EDEBE6" stroke-width="1.5"/><rect x="11" y="4" width="4" height="12" rx="1" fill="#EDEBE6"/><line x1="22" y1="8" x2="22" y2="23" stroke="#0052FF" stroke-width="1.5"/><rect x="20" y="11" width="4" height="8" rx="1" fill="#0052FF"/></svg>`;

/** Real (solid) vs simulated (hatched) split bar. Values are basis points or amounts. */
export function splitBar(reserve, operating, simulated, height = 12) {
  const t = reserve + operating + simulated || 1;
  return `<div class="splitbar" style="height:${height}px" role="img" aria-label="Reserve ${Math.round((reserve / t) * 100)}%, operating ${Math.round((operating / t) * 100)}%, simulated stocks ${Math.round((simulated / t) * 100)}%">
    <span class="fill-real" style="flex-grow:${reserve}"></span><span class="fill-ops" style="flex-grow:${operating}"></span><span class="hatch" style="flex-grow:${simulated}"></span></div>`;
}
export const LEGEND = `<div class="legend"><span><i class="fill-real"></i>Reserve</span><span><i class="fill-ops"></i>Operating</span><span><i class="hatch"></i>Paper stocks</span></div>`;

// ─── toasts
function toastRoot() {
  let r = $('.toasts');
  if (!r) { r = document.createElement('div'); r.className = 'toasts'; r.setAttribute('role', 'status'); r.setAttribute('aria-live', 'polite'); document.body.append(r); }
  return r;
}
export function toast(msg, kind = 'info', ms = 4200) {
  const t = document.createElement('div');
  t.className = `toast ${kind === 'error' ? 'err' : kind === 'ok' ? 'ok' : ''}`;
  t.innerHTML = `<span style="flex:none;margin-top:2px" class="${kind === 'error' ? 'bad' : kind === 'ok' ? 'good' : 'blue'}">${icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'spark', 16)}</span><span>${esc(msg)}</span>`;
  toastRoot().append(t);
  setTimeout(() => t.remove(), ms);
}

// ─── modal
export function modal(title, bodyHtml, { onClose, wide = false } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" style="${wide ? 'max-width:640px' : ''}">
    <div class="modal-head"><h3 style="font-size:22px">${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">${bodyHtml}</div></div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape' && !back.dataset.locked) close(); };
  back.addEventListener('click', (e) => { if ((e.target === back || e.target.closest('[data-close]')) && !back.dataset.locked) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  back.querySelector('[data-close]').focus();
  return { el: back, body: back.querySelector('.modal-body'), close, lock: (v = true) => { if (v) back.dataset.locked = '1'; else delete back.dataset.locked; } };
}

/** Renders a step list for multi-transaction flows. Returns a setter. */
export function stepper(container, labels) {
  container.innerHTML = `<div class="steps">${labels.map((l, i) => `<div class="step wait" data-i="${i}"><span class="st"></span><span class="lbl">${esc(l)}</span></div>`).join('')}</div>`;
  return (i, state, label) => {
    const el = container.querySelector(`[data-i="${i}"]`);
    if (!el) return;
    el.className = `step ${state}`;
    el.querySelector('.st').innerHTML = state === 'done' ? icon('check', 14, 3) : state === 'fail' ? icon('x', 14, 3) : '';
    if (label) el.querySelector('.lbl').textContent = label;
  };
}

export function stars(n) {
  const r = Math.round(n || 0);
  return `<span class="row" role="img" aria-label="${r} out of 5 stars">${Array.from({ length: 5 }, (_, i) => `<span style="color:${i < r ? 'var(--amber)' : 'var(--dim)'}">${icon('star', 14).replace('fill="none"', i < r ? 'fill="currentColor"' : 'fill="none"')}</span>`).join('')}</span>`;
}
