import { api, isSignedIn, friendlyErr } from './api.js';
import { html, mount, ic, avatar, ring, donut, usd, bps, bpsCls, ago, toast, openModal, poll, busy, skeleton, empty, simChip, chip, statusDot, SPECS, PERMS, $, $$, delegate, raw } from './ui.js';
import { specOf, reportRow, statusChip, taskTypeLabel, catLabel, catIcon, catHint } from './components.js';
import { hireModal } from './hire.js';

const COL = { reserve: '#6EA8FF', stocks: '#A3E635', operating: '#F5B83D' };
const TABS = [['overview', 'Overview', 'eye'], ['reports', 'Reports', 'doc'], ['services', 'Services', 'store'], ['treasury', 'Treasury', 'wallet'], ['portfolio', 'Portfolio', 'trend']];

export async function render(view, id, query) {
  mount(view, skeleton(2));
  let a = await api('/agents/' + id);
  let tab = TABS.some((t) => t[0] === query.tab) ? query.tab : 'overview';
  let alive = true;

  const head = () => html`<div class="glass pad" style="margin-top:10px"><div class="row" style="gap:20px;align-items:center">
      ${avatar(a.avatar, 84)}
      <div style="flex:1;min-width:220px"><div class="row" style="gap:10px;flex-wrap:nowrap"><h1 style="font-size:clamp(1.5rem,7vw,2rem);min-width:0;overflow-wrap:anywhere">${a.name}</h1>${statusDot(a.status)}</div>
        <p class="mute" style="max-width:56ch;margin:6px 0 10px">${a.description || 'Research agent'}</p>
        <div class="row" style="gap:8px"><span class="chip">${ic(specOf(a.specialization).icon)} ${specOf(a.specialization).label}</span>
          ${a.onchainAgentId != null ? html`<span class="chip volt">${ic('shield')} Onchain #${a.onchainAgentId}</span>` : html`<span class="chip">Not onchain</span>`}
          ${a.demo ? chip('Demo agent', 'volt') : ''}<span class="chip">${a.config.researchFrequency.replace('_', ' ')}</span></div></div>
      <div class="row">${ring(a.stats.quality, 64)}
        ${a.isOwner ? html`<button class="btn primary" id="run">${ic('search')} Run research</button><button class="btn" id="toggle">${ic(a.status === 'paused' ? 'play' : 'pause')} ${a.status === 'paused' ? 'Resume' : 'Pause'}</button>` : ''}</div></div></div>
    <div class="tabs glass" role="tablist" style="margin-top:18px">${TABS.map(([k, l, i]) => html`<button class="tab" role="tab" data-tab="${k}" aria-selected="${tab === k}">${ic(i)} ${l}</button>`)}</div><div id="pane"></div>`;

  const paint = () => {
    mount(view, head());
    $('#run', view)?.addEventListener('click', runModal);
    $('#toggle', view)?.addEventListener('click', async (e) => { await busy(e.currentTarget, async () => { a = { ...a, ...(await api('/agents/' + id, { method: 'PATCH', body: { status: a.status === 'paused' ? 'active' : 'paused' } })) }; a.isOwner = true; }); paint(); });
    pane();
  };
  delegate(view, 'click', '[data-tab]', (_e, b) => { tab = b.dataset.tab; $$('[data-tab]', view).forEach((x) => x.setAttribute('aria-selected', String(x === b))); history.replaceState(null, '', `#/agent/${id}?tab=${tab}`); pane(); });

  const pane = async () => {
    const host = $('#pane', view);
    if (!host) return;
    const el = document.createElement('div');
    host.replaceChildren(el);
    mount(el, skeleton(2));
    try {
      if (tab === 'overview') overview(el);
      else if (tab === 'reports') mount(el, a.reports.length ? html`<div class="list">${a.reports.map(reportRow)}</div>` : empty('doc', 'No reports yet', a.isOwner ? 'Run a research task to publish the first one.' : 'This agent has not published anything.'));
      else if (tab === 'services') services(el);
      else if (tab === 'treasury') await treasury(el);
      else await portfolio(el);
    } catch (e) { mount(el, html`<p class="err">${friendlyErr(e)}</p>`); }
  };

  function overview(el) {
    const p = a.config.allocationPolicy;
    mount(el, html`<div class="grid g4">
      ${[['doc', a.stats.reports, 'Reports'], ['check', a.stats.completedTasks, 'Tasks done'], ['users', a.stats.orders, 'Deals'], ['coin', usd(a.stats.revenue), 'USDC earned']].map(([i, n, l]) => html`<div class="glass stat"><div class="ico">${ic(i)}</div><div><div class="n mono">${n}</div><div class="sm mute">${l}</div></div></div>`)}</div>
    <div class="grid g2" style="margin-top:16px">
      <div class="glass pad stack"><h3>Watching</h3><div class="row">${a.config.researchTargets.length ? a.config.researchTargets.map((t) => html`<span class="chip">${t}</span>`) : html`<span class="mute sm">Nothing yet</span>`}</div>
        <h3 style="margin-top:6px">Allowed to</h3><div class="row" style="gap:8px">${PERMS.map(([k, l, i]) => html`<span class="chip ${a.config.permissions[k] ? 'volt' : ''}" style="${a.config.permissions[k] ? '' : 'opacity:.45;text-decoration:line-through'}">${ic(i)} ${l}</span>`)}</div></div>
      <div class="glass pad stack"><h3>How earnings are split</h3><div class="row" style="gap:22px">${donut([{ value: p.reservePercentage, color: COL.reserve }, { value: p.simulatedStockPercentage, color: COL.stocks }, { value: p.operatingPercentage, color: COL.operating }], 110, 14)}
        <div class="stack" style="gap:6px">${[['reserve', 'Reserve', p.reservePercentage], ['stocks', 'Practice stocks', p.simulatedStockPercentage], ['operating', 'Operating', p.operatingPercentage]].map(([k, l, v]) => html`<span class="sm"><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${COL[k]};margin-right:8px"></i>${l} <b>${v}%</b></span>`)}</div></div></div></div>
    <div class="sec"><h2>Recent work</h2>${a.tasks.length ? html`<div class="list">${a.tasks.map((t) => html`<div class="li"><span class="chip">${taskTypeLabel[t.type]}</span><div class="grow"><b>${t.target}</b>${t.error ? html`<div class="xs err">${t.error}</div>` : ''}</div><span class="xs mute">${ago(t.createdAt)}</span>${statusChip(t.status)}${t.reportId ? html`<a class="btn sm" href="#/report/${t.reportId}">Open</a>` : ''}</div>`)}</div>` : html`<p class="mute">No tasks yet.</p>`}</div>`);
  }

  function services(el) {
    const form = a.isOwner ? html`<div class="glass pad stack" style="margin-top:16px"><h3>Add a service</h3>
      <div class="grid g2"><label class="f">Name<input id="s-title" maxlength="80" placeholder="Company deep-dive"></label><label class="f">Price (USDC)<input id="s-price" inputmode="decimal" placeholder="5"></label></div>
      <label class="f">What buyers get<input id="s-desc" maxlength="400" placeholder="Filings, financials and recent headlines"></label>
      <div class="row">${Object.entries(catLabel).map(([k, l], i) => html`<button class="chip pick" data-cat="${k}" aria-pressed="${i === 0}">${ic(catIcon[k])} ${l}</button>`)}</div>
      <div class="row"><button class="btn primary" id="s-add">${ic('plus')} List service</button></div></div>` : '';
    mount(el, html`${a.services.length ? html`<div class="list">${a.services.map((s) => html`<div class="li"><span class="chip">${ic(catIcon[s.category])} ${catLabel[s.category]}</span><div class="grow"><b>${s.title}</b><div class="sm mute">${s.description}</div></div>
        <span class="mono">${usd(s.price)} USDC</span>${a.isOwner ? html`<button class="btn sm" data-toggle="${s.id}" data-on="${s.isActive}">${s.isActive ? 'Listed' : 'Hidden'}</button>` : html`<button class="btn sm primary" data-hire="${s.id}" ${s.isActive && a.status === 'active' ? '' : 'disabled'}>Hire</button>`}</div>`)}</div>` : empty('store', 'No services listed', a.isOwner ? 'List one so others can hire this agent.' : '')}${form}`);
    let cat = 'company_research';
    delegate(el, 'click', '[data-cat]', (_e, b) => { cat = b.dataset.cat; $$('[data-cat]', el).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
    delegate(el, 'click', '[data-hire]', (_e, b) => hireModal(a.services.find((s) => s.id === b.dataset.hire), a));
    delegate(el, 'click', '[data-toggle]', async (_e, b) => { try { await api('/services/' + b.dataset.toggle, { method: 'PATCH', body: { isActive: b.dataset.on !== 'true' } }); a = await api('/agents/' + id); services(el); } catch (e) { toast(friendlyErr(e), 'err'); } });
    $('#s-add', el)?.addEventListener('click', async (e) => {
      try { await busy(e.currentTarget, () => api(`/agents/${id}/services`, { method: 'POST', body: { title: $('#s-title').value, description: $('#s-desc').value, price: $('#s-price').value.trim(), category: cat } })); toast('Service listed', 'ok'); a = await api('/agents/' + id); services(el); } catch (err) { toast(friendlyErr(err), 'err'); }
    });
  }

  const label = { revenue: 'Earned', allocation: 'Split by rules', faucet: 'Starter grant', expense: 'Compute cost', escrow_hold: 'Held for a hire', escrow_refund: 'Refunded' };
  async function treasury(el) {
    const t = await api(`/agents/${id}/treasury`);
    const b = t.balances;
    const txs = [...t.entries.reduce((m, e) => { const g = m.get(e.txId) || { type: e.type, at: e.at, d: 0n, c: 0n, ref: e.reference }; g.d += BigInt(e.debit); g.c += BigInt(e.credit); return m.set(e.txId, g); }, new Map()).values()];
    mount(el, html`<div class="grid g2"><div class="glass pad"><div class="row between"><h3>Treasury</h3>${simChip()}</div>
      <div class="row" style="gap:26px;margin-top:14px"><div style="position:relative">${donut([{ value: Number(b.reserve), color: COL.reserve }, { value: Number(b.simStocks), color: COL.stocks }, { value: Number(b.operating), color: COL.operating }], 150, 18)}<div style="position:absolute;inset:0;display:grid;place-content:center;text-align:center"><div class="mono" style="font-size:1.15rem">${usd(b.total)}</div><div class="xs mute">USDC</div></div></div>
        <div class="stack" style="gap:8px">${[['reserve', 'Reserve', b.reserve], ['stocks', 'Practice stocks', b.simStocks], ['operating', 'Operating', b.operating]].map(([k, l, v]) => html`<span class="sm"><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${COL[k]};margin-right:8px"></i>${l}<br><b class="mono">${usd(v)}</b></span>`)}</div></div></div>
      <div class="glass pad stack"><h3>Totals</h3><div class="kpis"><div class="kpi"><div class="k">Earned</div><div class="v mono up">${usd(t.revenue)}</div></div><div class="kpi"><div class="k">Spent</div><div class="v mono">${usd(t.expenses)}</div></div></div>
        <p class="xs mute">Every move is a balanced double entry. Money is stored in whole micro-units, never decimals.</p></div></div>
    <div class="sec"><h2>Money moves</h2>${txs.length ? html`<div class="list">${txs.slice(0, 20).map((x) => { const net = x.c > 0n && x.d === 0n ? -x.c : x.d > 0n && x.c === 0n ? x.d : x.d; return html`<div class="li"><span class="chip">${label[x.type] || x.type}</span><div class="grow xs mute">${x.ref || ''}</div><span class="mono ${net < 0n ? 'down' : x.type === 'allocation' ? 'mute' : 'up'}">${net < 0n ? '' : x.type === 'allocation' ? '' : '+'}${usd(net)}</span><span class="xs mute">${ago(x.at)}</span></div>`; })}</div>` : html`<p class="mute">Nothing yet.</p>`}</div>`);
  }

  async function portfolio(el) {
    const p = await api(`/agents/${id}/portfolio`);
    const pal = ['#A3E635', '#6EA8FF', '#F5B83D', '#C084FC', '#FB7185', '#2DD4BF'];
    const sh = (s) => (Number(s) / 1e6).toFixed(Number(s) % 1e6 === 0 ? 0 : 2);
    mount(el, html`<div class="glass pad stack"><div class="row between"><h3>Practice portfolio</h3>${simChip()}</div><p class="sm mute">${p.note}</p>
      ${p.priceSource.startsWith('synthetic') ? html`<span class="chip amber">${ic('warn')} Live prices unreachable, showing placeholder prices</span>` : ''}</div>
    ${p.positions.length ? html`<div class="grid g2" style="margin-top:16px">
      <div class="glass pad"><div class="kpis"><div class="kpi"><div class="k">Total value</div><div class="v mono">${usd(p.totalValue)}</div></div><div class="kpi"><div class="k">Profit or loss</div><div class="v mono ${bpsCls(p.returnBps)}">${bps(p.returnBps)}</div></div><div class="kpi"><div class="k">Cash left</div><div class="v mono">${usd(p.cash)}</div></div></div>
        <h3 style="margin:20px 0 10px">Against the market</h3>${[['This agent', p.returnBps, 'var(--volt)'], ['SPY index', p.benchmark.returnBps, 'var(--blue)']].map(([n, v, c]) => html`<div style="margin-bottom:12px"><div class="row between sm"><span>${n}</span><span class="mono ${bpsCls(v)}">${bps(v)}</span></div><div class="bar-h"><i style="width:${Math.min(100, Math.abs(Number(v)) / 20 + 4)}%;background:${c}"></i></div></div>`)}</div>
      <div class="glass pad row" style="gap:22px">${donut(p.positions.map((x, i) => ({ value: Number(x.value), color: pal[i % pal.length] })), 130, 16)}
        <div class="stack" style="gap:6px;flex:1;min-width:150px">${p.positions.map((x, i) => html`<div class="row between sm"><span><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${pal[i % pal.length]};margin-right:8px"></i><b>${x.ticker}</b> <span class="mute">${sh(x.shares)} sh</span></span><span class="mono ${bpsCls(x.pnlBps)}">${bps(x.pnlBps)}</span></div>`)}</div></div></div>
      <div class="sec"><h2>Practice buys</h2><div class="list">${p.history.slice(0, 8).map((h) => html`<div class="li"><b>${h.ticker}</b><div class="grow xs mute">${ago(h.at)}</div><span class="mono">${usd(h.cost)}</span></div>`)}</div></div>`
      : html`<div style="margin-top:16px">${empty('pie', 'No positions yet', 'Earnings are split by the rules. The stock share is used for practice buys.')}</div>`}`);
  }

  function runModal() {
    let type = 'company_research';
    openModal(html`<div class="stack"><h3>Run research</h3>
      <div class="row">${Object.entries(taskTypeLabel).map(([k, l]) => html`<button class="chip pick" data-type="${k}" aria-pressed="${k === type}">${l}</button>`)}</div>
      <label class="f">Target<input id="rt" maxlength="60" placeholder="Ticker or name, e.g. NVDA" autocomplete="off"></label>
      <button class="btn primary" id="rgo">${ic('bolt')} Start</button><div id="rs"></div></div>`, (sheet, close) => {
      const hints = { company_research: 'Ticker or name, e.g. NVDA', earnings_analysis: 'Ticker or name, e.g. LLY', industry_analysis: 'Industry, e.g. semiconductors', market_summary: 'US market' };
      delegate(sheet, 'click', '[data-type]', (_e, b) => { type = b.dataset.type; $$('[data-type]', sheet).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('#rt', sheet).placeholder = hints[type]; if (type === 'market_summary') $('#rt', sheet).value = 'US market'; });
      $('#rgo', sheet).onclick = async (e) => {
        const target = $('#rt', sheet).value.trim(); if (!target) return toast('Enter a target', 'err');
        try {
          await busy(e.currentTarget, async () => {
            const t = await api(`/agents/${id}/tasks`, { method: 'POST', body: { taskType: type, target } });
            mount($('#rs', sheet), html`<div class="row"><span class="spin"></span> Researching…</div>`);
            const r = await poll(() => api('/tasks/' + t.id), (x) => ['completed', 'failed'].includes(x.status), { every: 2000 });
            if (r.status === 'completed') { mount($('#rs', sheet), html`<div class="row between"><span class="chip green">${ic('check')} Report ready</span><a class="btn primary sm" href="#/report/${r.reportId}" data-close>Open</a></div>`); }
            else mount($('#rs', sheet), html`<p class="err">${r.error || 'The research failed.'}</p>`);
          });
        } catch (err) { toast(friendlyErr(err), 'err'); }
      };
    });
  }

  paint();
  return () => { alive = false; };
}
