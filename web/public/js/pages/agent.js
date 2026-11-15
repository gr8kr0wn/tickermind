import { mountNav } from '../nav.js';
import { api, session } from '../api.js';
import { $, $$, qs, esc, icon, identicon, hydrateIcons, splitBar, LEGEND, modal, stepper, toast, usd, ago, pad, short, stars, SECTOR_ON, SECTOR_LABEL, STRATEGY_LABEL, FREQ_LABEL } from '../ui.js';
import { write, toRaw, walletError, account, connect, explorerTx, requireSignIn } from '../wallet.js';
import { openBuy } from '../buy.js';

mountNav('');
hydrateIcons();

const id = qs('id');
let data; // { agent, treasury, services, isOwner }
let tab = location.hash.slice(1) || 'research';

const STATUS_TAG = { fulfilled: 'tag-good', pending: 'tag-blue', refunded: 'tag-amber', failed: 'tag-bad' };
const POLICIES = [
  { id: 'safe', label: 'Safe', reserve: 6000, operating: 2000, simulated: 2000 },
  { id: 'balanced', label: 'Balanced', reserve: 4000, operating: 2000, simulated: 4000 },
  { id: 'bold', label: 'Bold', reserve: 2000, operating: 2000, simulated: 6000 },
];

async function load() {
  if (!id) { location.href = '/marketplace'; return; }
  try {
    data = await api.get(`agents?id=${encodeURIComponent(id)}`);
  } catch (e) {
    $('#side').innerHTML = `<div class="empty">${icon('alert', 28)}<span>${esc(e.message)}</span><a href="/marketplace" class="btn btn-glass">Back to marketplace</a></div>`;
    return;
  }
  document.title = `${data.agent.name} — TickerMind`;
  renderSide();
  renderKpis();
  showTab(tab);
}

// ─── identity card
function renderSide() {
  const a = data.agent;
  const t = data.treasury && !data.treasury.error ? data.treasury : null;
  const p = t?.policy || a.policy;
  const perm = a.permissions || {};
  $('#side').innerHTML = `<div class="side-card" data-sector="${esc(a.sector)}">
    <div class="side-top tint">
      <span class="mono" style="position:absolute;left:18px;top:16px;font-size:12px;color:rgba(255,255,255,.8)">${pad(a.onchainId)}</span>
      ${data.isOwner ? '<span class="tag" style="position:absolute;right:14px;top:12px;background:rgba(0,0,0,.35);color:#fff">YOU OWN THIS</span>' : ''}
      ${identicon(a.name, SECTOR_ON[a.sector], 132)}
    </div>
    <div class="side-body">
      <div class="stack gap-12">
        <h1 style="font-size:30px;word-break:break-word">${esc(a.name)}</h1>
        ${a.description ? `<p class="muted" style="font-size:15px">${esc(a.description)}</p>` : ''}
        <div class="wrap-row gap-8"><span class="tag tag-blue">${esc(SECTOR_LABEL[a.sector] || a.sector)}</span><span class="tag">${esc(STRATEGY_LABEL[a.strategy] || '')}</span><span class="tag">${esc(FREQ_LABEL[a.frequency] || '')}</span></div>
        ${a.focusTickers?.length ? `<div class="wrap-row gap-8">${a.focusTickers.map((tk) => `<span class="tag mono">${esc(tk)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="stack gap-8"><div class="row between muted" style="font-size:12px"><span>Policy (onchain)</span><span class="mono">${p.reserve / 100}/${p.operating / 100}/${p.simulated / 100}</span></div>${splitBar(p.reserve, p.operating, p.simulated, 10)}${LEGEND}</div>
      <div class="stack gap-8 perm-list" style="font-size:14px">
        ${[['Read market data', true], ['Generate research', true], ['Receive USDC', true], ['Publish reports', perm.publish_reports === 'auto' ? 'Auto' : 'Approval'], ['Execute trades', false]]
          .map(([l, v]) => `<div class="row between"><span class="muted">${l}</span>${v === false ? `<span class="tag">${icon('lock', 11)}Locked</span>` : v === true ? `<span class="tag tag-blue">${icon('check', 11)}On</span>` : `<span class="tag tag-amber">${v}</span>`}</div>`).join('')}
      </div>
      <div class="row between mono dim" style="font-size:12px"><span>OWNER</span><span>${short(a.owner)}</span></div>
    </div></div>`;
}

function renderKpis() {
  const a = data.agent;
  const t = data.treasury && !data.treasury.error ? data.treasury : null;
  $('#kpis').innerHTML = `
    <div class="kpi"><span>${icon('file', 13)}Reports</span><b>${a.stats?.reports ?? 0}</b></div>
    <div class="kpi"><span>${icon('check', 13)}Services done</span><b>${a.stats?.completed ?? 0}</b></div>
    <div class="kpi"><span>${icon('coins', 13)}Revenue</span><b class="blue">${t ? usd(t.earned) : '—'}</b></div>
    <div class="kpi"><span>${icon('wallet', 13)}Treasury</span><b>${t ? usd(t.balance) : '—'}</b></div>
    <div class="kpi sim"><span>${icon('pie', 13)}Paper portfolio</span><b class="amber" id="kpi-paper">…</b></div>
    <div class="kpi"><span>${icon('activity', 13)}Active tasks</span><b>${a.stats?.pending ?? 0}</b></div>`;
  api.get(`treasury?agentId=${id}`).then((tr) => { $('#kpi-paper').textContent = usd(tr.simulated.value); }).catch(() => { $('#kpi-paper').textContent = '—'; });
}

// ─── tabs
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) showTab(b.dataset.tab);
});
function showTab(name) {
  tab = ['research', 'services', 'treasury', 'activity'].includes(name) ? name : 'research';
  history.replaceState(null, '', `#${tab}`);
  $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  ({ research, services, treasury, activity })[tab]();
}

// ─── RESEARCH
async function research() {
  const panel = $('#panel');
  const owner = data.isOwner;
  panel.innerHTML = `<div class="stack gap-20">
    ${owner ? `<form class="panel row gap-12 wrap-row" id="rs-form" style="align-items:center">
      <label for="rs-ticker" class="sr-only">Ticker</label>
      <input id="rs-ticker" class="input mono" style="flex:1 1 160px;text-transform:uppercase;font-size:18px" maxlength="10" placeholder="Ticker, e.g. ${esc(data.agent.focusTickers?.[0] || 'NVDA')}" required>
      <button class="btn btn-primary" id="rs-go">${icon('search')} Research</button>
      ${data.agent.focusTickers?.length ? `<div class="wrap-row gap-8" style="flex-basis:100%">${data.agent.focusTickers.map((t) => `<button type="button" class="chip" data-tk="${esc(t)}" style="min-height:36px">${esc(t)}</button>`).join('')}</div>` : ''}
    </form>` : ''}
    <div id="rs-list" class="stack gap-12"><div class="skeleton" style="height:88px"></div><div class="skeleton" style="height:88px"></div></div></div>`;

  if (owner) {
    const f = $('#rs-form');
    f.addEventListener('click', (e) => { const c = e.target.closest('[data-tk]'); if (c) { $('#rs-ticker').value = c.dataset.tk; } });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#rs-go');
      const ticker = $('#rs-ticker').value.trim().toUpperCase();
      btn.disabled = true;
      const msgs = ['Reading SEC filings…', 'Pulling market data…', 'Cross-checking sources…', 'Writing the report…'];
      let k = 0;
      btn.innerHTML = `<span class="spinner"></span> ${msgs[0]}`;
      const timer = setInterval(() => { k = Math.min(k + 1, msgs.length - 1); btn.innerHTML = `<span class="spinner"></span> ${msgs[k]}`; }, 4000);
      try {
        const out = await api.post('research', { action: 'run', agentId: id, ticker });
        toast(out.cached ? 'Recent report found — opening it.' : out.published ? 'Report published.' : 'Draft ready. Review and publish it.', 'ok');
        location.href = `/report?id=${out.reportId}`;
      } catch (err) {
        toast(err.message, 'error', 7000);
      } finally {
        clearInterval(timer);
        btn.disabled = false;
        btn.innerHTML = `${icon('search')} Research`;
      }
    });
  }

  try {
    const { reports } = await api.get(`reports?agentId=${id}`);
    $('#rs-list').innerHTML = reports.length ? reports.map((r) => {
      const b = r.bullScore ?? 50;
      const badge = r.origin === 'order' ? '<span class="tag tag-good">Sold</span>' : r.published ? '<span class="tag tag-blue">Public</span>' : '<span class="tag tag-amber">Draft</span>';
      return `<a href="/report?id=${esc(r.id)}" class="rep-row">
        <span class="tk">${esc(r.ticker)}</span>
        <span class="stack gap-4" style="min-width:0"><b style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.company)}</b><span class="muted mono" style="font-size:12px">${ago(r.createdAt)} · ${esc(r.hash.slice(0, 10))}…</span></span>
        <span class="stack gap-4 minitug-wrap"><span class="mono" style="font-size:12px"><span class="blue">Bull ${b}</span></span><span class="minitug"><span class="fill-real" style="flex-grow:${b}"></span><span style="flex-grow:${100 - b};background:#D9A441"></span></span></span>
        ${badge}</a>`;
    }).join('') : `<div class="empty">${icon('file', 28)}<span>${owner ? 'No research yet. Enter a ticker above.' : 'No public reports yet.'}</span></div>`;
  } catch (e) { $('#rs-list').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

// ─── SERVICES
function services() {
  const owner = data.isOwner;
  const list = data.services;
  $('#panel').innerHTML = `<div class="stack gap-16">
    ${list.length ? list.map((s) => `<div class="svc-row">
      <div class="stack gap-8" style="min-width:0;flex:1 1 240px"><b style="font-size:18px">${esc(s.title)}</b>
        <div class="wrap-row gap-8">${s.defaultTicker ? `<span class="tag tag-blue">${esc(s.defaultTicker)}</span>` : '<span class="tag">Any ticker</span>'}${s.active ? '' : '<span class="tag tag-amber">Paused</span>'}<span class="tag mono">SERVICE ${pad(s.onchainId)}</span></div></div>
      <div class="row gap-12"><b class="mono" style="font-size:22px">${esc(s.price)}<span class="dim" style="font-size:13px"> USDC</span></b>
      ${owner ? `<button class="btn btn-glass btn-sm" data-toggle="${esc(s.id)}">${s.active ? 'Pause' : 'Resume'}</button>` : s.active ? `<button class="btn btn-paper btn-sm" data-buy="${esc(s.id)}">Request</button>` : ''}</div></div>`).join('')
      : `<div class="empty">${icon('tag', 28)}<span>${owner ? 'List a service so buyers can pay for reports.' : 'This agent is not selling yet.'}</span></div>`}
    ${owner ? `<form class="panel stack gap-16" id="svc-form"><b style="font-size:18px">${icon('plus', 16)} New service</b>
      <div class="wrap-row gap-12">
        <div class="field" style="flex:2 1 220px"><label class="label" for="svc-title">Title</label><input id="svc-title" class="input" maxlength="80" placeholder="NVIDIA company research report" required></div>
        <div class="field" style="flex:1 1 120px"><label class="label" for="svc-tk">Ticker</label><input id="svc-tk" class="input mono" maxlength="10" placeholder="Any" style="text-transform:uppercase"></div>
        <div class="field" style="flex:1 1 120px"><label class="label" for="svc-price">Price</label><div class="input-prefix"><input id="svc-price" class="input mono" type="number" min="0.01" step="0.01" value="5" required><span>USDC</span></div></div>
      </div><button class="btn btn-primary" style="align-self:flex-start">List service</button></form>`
      : `<a href="/marketplace" class="panel row gap-12" style="color:var(--paper)">${icon('users', 20)}<span class="stack gap-4"><b>Own an agent?</b><span class="muted" style="font-size:14px">Your agent can buy from this one using its own treasury.</span></span><span style="margin-left:auto">${icon('arrow')}</span></a>`}
  </div>`;

  $('#panel').onclick = async (e) => {
    const buy = e.target.closest('[data-buy]');
    if (buy) {
      const s = list.find((x) => x.id === buy.dataset.buy);
      return openBuy({ ...s, agent: { id: data.agent.id, name: data.agent.name, sector: data.agent.sector, onchainId: data.agent.onchainId } });
    }
    const tg = e.target.closest('[data-toggle]');
    if (tg) {
      const s = list.find((x) => x.id === tg.dataset.toggle);
      tg.disabled = true;
      try {
        const tx = await write('marketplace', 'updateService', [BigInt(s.onchainId), toRaw(s.price), !s.active]);
        await api.post('services', { action: 'update', id: s.id, txHash: tx.hash });
        s.active = !s.active;
        toast(s.active ? 'Service resumed.' : 'Service paused.', 'ok');
        services();
      } catch (err) { toast(walletError(err), 'error'); tg.disabled = false; }
    }
  };

  $('#svc-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Listing…';
    try {
      const svc = await api.post('services', { action: 'create', agentId: id, title: $('#svc-title').value, defaultTicker: $('#svc-tk').value.trim() || undefined, price: Number($('#svc-price').value) });
      const tx = await write('marketplace', 'createService', [BigInt(svc.agentOnchainId), BigInt(svc.priceRaw), svc.metadataURI]);
      await api.post('services', { action: 'confirm', id: svc.id, txHash: tx.hash });
      toast('Service listed.', 'ok');
      data = await api.get(`agents?id=${id}`);
      services();
    } catch (err) { toast(walletError(err), 'error'); btn.disabled = false; btn.textContent = 'List service'; }
  });
}

// ─── TREASURY
async function treasury() {
  const panel = $('#panel');
  panel.innerHTML = '<div class="skeleton" style="height:420px"></div>';
  let tr;
  try { tr = await api.get(`treasury?agentId=${id}`); } catch (e) { panel.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const owner = data.isOwner;
  const r = tr.real && !tr.real.error ? tr.real : null;
  const p = r?.policy || data.agent.policy;
  const bal = r?.balance || 0;
  const amt = (bps) => (bal * bps) / 1e4;
  const sim = tr.simulated;
  const latest = tr.allocations[0];

  panel.innerHTML = `<div class="stack gap-20">
    <div class="real-box stack gap-20">
      <div class="row between wrap-row gap-12"><span class="tag tag-blue">${icon('shield', 12)}Real · USDC onchain</span>
        ${owner ? `<div class="row gap-8"><button class="btn btn-glass btn-sm" id="pol-btn">${icon('pie', 14)}Policy</button><button class="btn btn-glass btn-sm" id="wd-btn" ${bal > 0 ? '' : 'disabled'}>${icon('wallet', 14)}Withdraw</button></div>` : ''}</div>
      <div class="stack gap-4"><span class="muted" style="font-size:13px">Available balance</span><span class="big">${usd(bal)}</span></div>
      ${splitBar(p.reserve, p.operating, p.simulated, 16)}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">
        <div class="stack gap-4"><span class="row gap-8 muted" style="font-size:13px"><i class="fill-real" style="width:10px;height:10px;border-radius:3px"></i>Reserve ${p.reserve / 100}%</span><b class="mono">${usd(amt(p.reserve))}</b></div>
        <div class="stack gap-4"><span class="row gap-8 muted" style="font-size:13px"><i class="fill-ops" style="width:10px;height:10px;border-radius:3px"></i>Operating ${p.operating / 100}%</span><b class="mono">${usd(amt(p.operating))}</b></div>
        <div class="stack gap-4"><span class="row gap-8 muted" style="font-size:13px"><i class="hatch" style="width:10px;height:10px;border-radius:3px"></i>Paper sleeve ${p.simulated / 100}%</span><b class="mono">${usd(amt(p.simulated))}</b></div>
      </div>
      <div class="row gap-24 wrap-row mono muted" style="font-size:13px"><span>Earned ${usd(r?.earned)}</span><span>Spent on agents ${usd(r?.spent)}</span><span>Withdrawn ${usd(r?.withdrawn)}</span><span>Op. budget ${usd(tr.operatingBudget)} <span class="tag tag-amber">sim</span></span></div>
    </div>

    <div class="sim-box stack gap-20">
      <div class="row between wrap-row gap-12"><span class="tag tag-amber">${icon('pie', 12)}Simulated · paper portfolio</span>
        ${owner ? `<button class="btn btn-paper btn-sm" id="alloc-btn">${icon('spark', 14)}Run allocation</button>` : ''}</div>
      <div class="wrap-row gap-32">
        <div class="stack gap-4"><span class="muted" style="font-size:13px">Paper value</span><span class="big amber">${usd(sim.value)}</span></div>
        <div class="stack gap-4"><span class="muted" style="font-size:13px">P&amp;L</span><span class="big ${sim.pnl >= 0 ? 'good' : 'bad'}" style="font-size:28px">${sim.pnl >= 0 ? '+' : ''}${usd(sim.pnl)}</span></div>
      </div>
      <div id="alloc-out">${latest && !latest.applied && owner ? allocCard(latest) : ''}</div>
      ${sim.positions.length ? `<div class="table-box"><table><thead><tr><th>Ticker</th><th>Shares</th><th>Cost</th><th>Price</th><th>Value</th><th>P&amp;L</th></tr></thead><tbody>${sim.positions.map((x) => `<tr><td class="mono"><b>${esc(x.ticker)}</b></td><td class="mono">${x.shares}</td><td class="mono">${usd(x.costBasis)}</td><td class="mono">${x.price != null ? usd(x.price) : '—'}</td><td class="mono">${usd(x.value)}</td><td class="mono ${x.pnl >= 0 ? 'good' : 'bad'}">${x.pnl >= 0 ? '+' : ''}${usd(x.pnl)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted" style="font-size:14px">No paper positions yet. The agent allocates its paper sleeve based on its own research scores.</p>'}
      <p class="dim" style="font-size:12px">Paper trades only. TickerMind never buys real or tokenized stocks.</p>
    </div>

    ${tr.allocations.length ? `<div class="stack gap-12"><b>Allocation history</b><div class="tl">${tr.allocations.map((a) => `<div class="tl-item"><span class="tl-dot" style="background:${a.applied ? 'rgba(87,217,163,.15)' : 'rgba(255,255,255,.06)'}">${icon(a.applied ? 'check' : 'pie', 13)}</span><span style="font-size:14px">${esc(a.rationale)}</span><span class="muted mono" style="font-size:12px">${ago(a.createdAt)}</span></div>`).join('')}</div></div>` : ''}
  </div>`;

  if (!owner) return;
  $('#alloc-btn').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.innerHTML = '<span class="spinner"></span> Evaluating…';
    try {
      const { allocation } = await api.post('treasury', { action: 'recommend', agentId: id });
      $('#alloc-out').innerHTML = allocCard(allocation);
    } catch (err) { toast(err.message, 'error'); }
    b.disabled = false; b.innerHTML = `${icon('spark', 14)}Run allocation`;
  };
  $('#alloc-out').onclick = async (e) => {
    const b = e.target.closest('[data-apply]');
    if (!b) return;
    b.disabled = true;
    try { await api.post('treasury', { action: 'apply', allocationId: b.dataset.apply }); toast('Paper positions opened.', 'ok'); treasury(); renderKpis(); }
    catch (err) { toast(err.message, 'error'); b.disabled = false; }
  };
  $('#wd-btn').onclick = () => withdraw(bal);
  $('#pol-btn').onclick = () => editPolicy(p);
}

function allocCard(a) {
  return `<div class="panel stack gap-12" style="background:rgba(12,13,11,.6)">
    <div class="row gap-8">${icon('spark', 16)}<b>Recommendation</b></div>
    <p style="font-size:15px">${esc(a.rationale)}</p>
    ${a.picks?.length ? `<div class="wrap-row gap-8">${a.picks.map((p) => `<span class="tag tag-amber mono">${esc(p.ticker)} · ${usd(p.amount)} · bull ${p.bullScore}</span>`).join('')}</div>
      <button class="btn btn-paper btn-sm" style="align-self:flex-start" data-apply="${esc(a.id)}">${icon('check', 14)}Apply to paper portfolio</button>` : ''}
  </div>`;
}

async function withdraw(max) {
  const m = modal('Withdraw USDC', `<form class="stack gap-16" id="wd-form">
    <div class="field"><label class="label" for="wd-amt">Amount</label><div class="input-prefix"><input id="wd-amt" class="input mono" type="number" min="0.01" step="0.01" max="${max}" value="${max}"><span>USDC</span></div></div>
    <p class="muted" style="font-size:14px">Goes to your connected wallet. Max ${usd(max)}.</p>
    <button class="btn btn-primary btn-block">${icon('wallet')} Withdraw</button></form>`);
  m.body.querySelector('#wd-form').onsubmit = async (e) => {
    e.preventDefault();
    const v = Number(m.body.querySelector('#wd-amt').value);
    if (!(v > 0 && v <= max)) return toast('Enter an amount up to your balance.', 'error');
    const btn = e.submitter; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Confirm in wallet…';
    try {
      const to = (await account()) || (await connect());
      await write('vault', 'withdraw', [BigInt(data.agent.onchainId), to, toRaw(v)]);
      m.close(); toast('Withdrawn.', 'ok');
      data = await api.get(`agents?id=${id}`); renderKpis(); treasury();
    } catch (err) { toast(walletError(err), 'error'); btn.disabled = false; btn.textContent = 'Withdraw'; }
  };
}

function editPolicy(current) {
  const m = modal('Treasury policy', `<div class="stack gap-16">
    <p class="muted" style="font-size:14px">Saved onchain in AgentVault. The agent follows it when it allocates.</p>
    <div class="stack gap-8">${POLICIES.map((p) => `<button class="step" style="cursor:pointer;border:1px solid ${p.reserve === current.reserve && p.simulated === current.simulated ? 'var(--blue)' : 'transparent'}" data-pol="${p.id}"><b style="width:90px;text-align:left">${p.label}</b><span style="flex:1">${splitBar(p.reserve, p.operating, p.simulated, 10)}</span><span class="mono muted" style="font-size:12px">${p.reserve / 100}/${p.operating / 100}/${p.simulated / 100}</span></button>`).join('')}</div>
    <div id="pol-steps"></div></div>`);
  m.body.onclick = async (e) => {
    const b = e.target.closest('[data-pol]');
    if (!b) return;
    const p = POLICIES.find((x) => x.id === b.dataset.pol);
    m.lock();
    const set = stepper(m.body.querySelector('#pol-steps'), [`Save ${p.label} policy onchain`]);
    set(0, 'active');
    try {
      await requireSignIn();
      const tx = await write('vault', 'setPolicy', [BigInt(data.agent.onchainId), p.reserve, p.operating, p.simulated]);
      await api.post('agents', { action: 'policy', id, txHash: tx.hash });
      set(0, 'done'); toast('Policy saved.', 'ok');
      data = await api.get(`agents?id=${id}`);
      setTimeout(() => { m.lock(false); m.close(); renderSide(); treasury(); }, 500);
    } catch (err) { set(0, 'fail'); m.lock(false); toast(walletError(err), 'error'); }
  };
}

// ─── ACTIVITY
async function activity() {
  const panel = $('#panel');
  panel.innerHTML = '<div class="skeleton" style="height:300px"></div>';
  try {
    const { sold, bought } = await api.get(`orders?agentId=${id}`);
    const items = [...sold.map((o) => ({ ...o, dir: 'sold' })), ...bought.map((o) => ({ ...o, dir: 'bought' }))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!items.length) { panel.innerHTML = `<div class="empty">${icon('activity', 28)}<span>No activity yet.</span></div>`; return; }
    const links = await Promise.all(items.map((o) => explorerTx(o.fulfillTx || o.purchaseTx)));
    panel.innerHTML = `<div class="tl">${items.map((o, i) => `<div class="tl-item">
      <span class="tl-dot" style="background:${o.dir === 'sold' ? 'rgba(0,82,255,.18)' : 'rgba(245,165,36,.16)'}">${icon(o.dir === 'sold' ? 'coins' : 'users', 13)}</span>
      <span class="stack gap-4" style="min-width:0"><span style="font-size:15px">${o.dir === 'sold' ? `Sold <b class="mono">${esc(o.ticker)}</b> report${o.buyerAgent ? ` to agent ${esc(o.buyerAgent.name)}` : ''}` : `Bought <b class="mono">${esc(o.ticker)}</b> research from ${esc(o.seller?.name || 'an agent')}`}</span>
      <span class="row gap-8 wrap-row"><span class="tag ${STATUS_TAG[o.status] || ''}">${esc(o.status)}</span>${o.rating ? `<span class="row">${stars(o.rating)}</span>` : ''}<a href="${esc(links[i])}" target="_blank" rel="noopener" class="mono" style="font-size:12px">tx ${icon('ext', 11)}</a></span></span>
      <span class="stack" style="align-items:flex-end;gap:2px"><b class="mono ${o.dir === 'sold' ? 'blue' : 'amber'}">${o.dir === 'sold' ? '+' : '−'}${o.amount}</b><span class="muted mono" style="font-size:11px">${ago(o.createdAt)}</span></span></div>`).join('')}</div>`;
  } catch (e) { panel.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

window.addEventListener('tm:session', load);
load();
