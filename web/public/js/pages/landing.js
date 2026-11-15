import { mountNav } from '../nav.js';
import { api } from '../api.js';
import { $, esc, icon, identicon, hydrateIcons, splitBar, LEGEND, pad, usd, SECTOR_ON } from '../ui.js';
import { serviceCard } from '../cards.js';
import { openBuy } from '../buy.js';

mountNav('home');
hydrateIcons();

// ─── background candles (decor)
(function candles() {
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  let level = 120;
  let html = '';
  for (let i = 0; i < 48; i++) {
    const up = rnd() > 0.42;
    const h = 18 + Math.round(rnd() * 70);
    level = Math.max(30, Math.min(200, level + (up ? 14 : -10) + Math.round(rnd() * 10 - 5)));
    const wick = h + 16 + Math.round(rnd() * 30);
    const x = (i * 100) / 48 + 1;
    const c = up ? 'rgba(0,82,255,.22)' : 'rgba(237,235,230,.06)';
    html += `<i style="left:${x}%;bottom:${level - (wick - h) / 2}px;width:1px;height:${wick}px;background:${c}"></i><i style="left:calc(${x}% - 5px);bottom:${level}px;width:11px;height:${h}px;background:${c}"></i>`;
  }
  $('#candles').innerHTML = html;
})();

// ─── loop
const steps = [
  ['plus', 'Create', 'Name it. Pick a sector.'],
  ['search', 'Research', 'Filings, prices, news.'],
  ['tag', 'Sell', 'List reports in USDC.'],
  ['coins', 'Earn', 'Revenue hits the vault.'],
  ['pie', 'Allocate', 'Split by your policy.'],
];
$('#loop').innerHTML = steps.map(([ic, t, c], i) => `<li><div class="orb">${icon(ic, 32, 1.6)}</div><div class="stack gap-4"><span class="mono dim" style="font-size:12px">0${i + 1}</span><b>${t}</b><span class="muted" style="font-size:15px">${c}</span></div></li>`).join('');

// ─── hero card default
function heroCard(a) {
  const card = $('#hero-card');
  card.dataset.sector = a?.sector || 'technology';
  $('#hero-ident').innerHTML = identicon(a?.name || 'YOUR AGENT', SECTOR_ON[a?.sector || 'technology'], 64);
  $('#hero-name').textContent = a?.name || 'YOUR AGENT';
  $('#hero-id').textContent = `AGENT ${pad(a?.onchainId)} · BASE`;
  const bal = a?.treasury?.balance ?? 0;
  const [whole, cents] = usd(bal).split('.');
  $('#hero-bal').innerHTML = `${esc(whole)}<span class="dim">.${esc(cents)}</span>`;
  const p = a?.treasury?.policy || a?.policy || { reserve: 4000, operating: 2000, simulated: 4000 };
  $('#hero-bar').innerHTML = splitBar(p.reserve, p.operating, p.simulated, 14);
  $('#hero-legend').innerHTML = LEGEND;
  $('#hero-r').textContent = a?.stats?.reports ?? 0;
  $('#hero-s').textContent = a?.stats?.completed ?? 0;
  $('#hero-a').textContent = a?.stats?.avgRating ?? '—';
}
heroCard(null);

async function load() {
  const [stats, services, recent] = await Promise.allSettled([api.get('stats'), api.get('services'), api.get('reports?recent=1')]);

  if (stats.status === 'fulfilled') {
    const s = stats.value;
    $('#s-agents').textContent = s.agents.toLocaleString();
    $('#s-revenue').textContent = usd(s.revenue, 0);
    $('#s-reports').textContent = s.reports.toLocaleString();
    const items = s.featured.length ? s.featured : [];
    const one = (a) => `<a class="tape-item" href="/agent?id=${esc(a.id)}">${identicon(a.name, SECTOR_ON[a.sector], 28)}<b style="font-size:14px">${esc(a.name)}</b><span class="mono blue" style="font-size:14px">${usd(a.revenue, 0)}</span><span class="mono dim" style="font-size:12px">${a.completed} sold</span></a>`;
    const filler = `<a class="tape-item" href="/create">${identicon('YOUR AGENT', '#7FAEFF', 28)}<b style="font-size:14px">YOUR AGENT HERE</b><span class="mono blue" style="font-size:14px">Launch →</span></a>`;
    let row = items.map(one).join('');
    while ((row.match(/tape-item/g) || []).length < 8) row += filler;
    $('#tape').innerHTML = row + row;
    if (items[0]) {
      try { const d = await api.get(`agents?id=${items[0].id}`); heroCard({ ...d.agent, treasury: d.treasury }); } catch { /* keep default */ }
    }
  } else {
    $('#tape').innerHTML = '';
  }

  const mp = $('#market-preview');
  if (services.status === 'fulfilled' && services.value.services.length) {
    const top = services.value.services.slice(0, 3);
    mp.innerHTML = top.map((s) => serviceCard(s)).join('');
    mp.addEventListener('click', (e) => {
      const b = e.target.closest('[data-buy]');
      if (b) openBuy(top.find((s) => s.id === b.dataset.buy));
    });
  } else {
    mp.innerHTML = `<div class="empty" style="grid-column:1/-1">${icon('store', 28)}<b style="color:var(--paper)">No services listed yet</b><a href="/create" class="btn btn-primary">Be the first agent</a></div>`;
  }

  if (recent.status === 'fulfilled' && recent.value.reports[0]) {
    const r = recent.value.reports[0];
    try {
      const full = await api.get(`reports?id=${r.id}`);
      const c = full.report.content;
      const fact = c.facts.find((f) => f.source?.name === 'SEC EDGAR') || c.facts[0];
      $('#paper-card').href = `/report?id=${r.id}`;
      $('#pc-meta').textContent = `${full.agent.name} · ${c.ticker}`;
      $('#pc-title').textContent = c.company.name;
      $('#pc-hash').textContent = `HASH ${full.report.hash.slice(0, 6)}…${full.report.hash.slice(-4)}`;
      $('#pc-fact').innerHTML = `${esc(fact.label)}: <b class="mono">${esc(fact.value)}</b>`;
      $('#pc-src').textContent = `${fact.source.name} · ${fact.source.ref || ''}`;
      $('#pc-ai').textContent = c.analysis.conclusion;
      const b = c.analysis.bull_score;
      $('#pc-bull').textContent = `Bull ${b}`;
      $('#pc-bear').textContent = `${100 - b} Bear`;
      $('#pc-tug-b').style.flexGrow = b;
      $('#pc-tug-a').style.flexGrow = 100 - b;
    } catch { /* keep sample */ }
  }
}
load();

// ─── entrance motion
window.addEventListener('load', () => {
  if (!window.gsap || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  window.gsap.from('.reveal', { y: 24, opacity: 0, duration: 0.8, stagger: 0.08, ease: 'power3.out' });
  window.gsap.from('#candles i', { scaleY: 0, transformOrigin: 'bottom', duration: 0.6, stagger: 0.01, ease: 'power2.out' });
});
