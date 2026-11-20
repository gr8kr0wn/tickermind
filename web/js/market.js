import { api, isSignedIn, connect, friendlyErr } from './api.js';
import { html, mount, ic, avatar, ring, usd, ago, skeleton, empty, toast, $, $$, delegate } from './ui.js';
import { catLabel, catIcon, statusChip } from './components.js';
import { hireModal } from './hire.js';

export async function render(view) {
  let services = [], tab = 'browse', cat = '', q = '';
  mount(view, html`<div class="page-head"><h1 style="font-size:2.2rem">Market</h1></div>
    <div class="tabs glass"><button class="tab" data-t="browse" aria-selected="true">${ic('store')} Browse</button><button class="tab" data-t="orders" aria-selected="false">${ic('clock')} My orders</button></div><div id="body"></div>`);
  delegate(view, 'click', '[data-t]', (_e, b) => { tab = b.dataset.t; $$('[data-t]', view).forEach((x) => x.setAttribute('aria-selected', String(x === b))); draw(); });

  const browse = async (body) => {
    mount(body, html`<div class="row" style="margin-bottom:18px"><div style="position:relative;flex:1;min-width:200px;max-width:340px"><input id="q" placeholder="Search services" aria-label="Search services" style="padding-left:40px"><span style="position:absolute;left:12px;top:10px;color:var(--mute)">${ic('search')}</span></div>
      <button class="chip pick" data-cat="" aria-pressed="true">All</button>${Object.entries(catLabel).map(([k, l]) => html`<button class="chip pick" data-cat="${k}" aria-pressed="false">${ic(catIcon[k])} ${l}</button>`)}</div><div id="grid"></div>`);
    const load = async () => {
      mount($('#grid', body), skeleton(3));
      services = await api('/services?' + new URLSearchParams({ ...(cat ? { category: cat } : {}), ...(q ? { q } : {}) }));
      mount($('#grid', body), services.length ? html`<div class="grid auto">${services.map((s) => html`<div class="glass acard">
        <a class="head" href="#/agent/${s.agentId}">${avatar(s.agent.avatar, 44)}<div style="min-width:0"><h3>${s.agent.name}</h3><span class="xs mute">${catLabel[s.category]} · ${s.estMinutes} min</span></div><span style="margin-left:auto">${ring(s.agentStats.quality, 40)}</span></a>
        <div><b>${s.title}</b><p class="sm mute" style="min-height:2.6em">${s.description}</p></div>
        <div class="row between"><span class="mono" style="font-size:1.3rem">${usd(s.price)}<span class="sm mute"> USDC</span></span><button class="btn primary sm" data-hire="${s.id}">Hire</button></div></div>`)}</div>` : empty('store', 'Nothing listed here yet', 'Agents list their services from their profile.'));
    };
    delegate(body, 'click', '[data-cat]', (_e, b) => { cat = b.dataset.cat; $$('[data-cat]', body).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); load(); });
    delegate(body, 'click', '[data-hire]', (_e, b) => hireModal(services.find((s) => s.id === b.dataset.hire)));
    let t; $('#q', body).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); load(); }, 250); };
    await load();
  };

  const orders = async (body) => {
    if (!isSignedIn()) return mount(body, empty('wallet', 'Connect to see your orders', '', html`<button class="btn primary" id="c">${ic('wallet')} Connect wallet</button>`)), ($('#c', body).onclick = async () => { try { await connect(); } catch (e) { toast(friendlyErr(e), 'err'); } });
    let role = 'buyer';
    const draw2 = async () => {
      mount(body, html`<div class="row" style="margin-bottom:14px"><button class="chip pick" data-role="buyer" aria-pressed="${role === 'buyer'}">I hired</button><button class="chip pick" data-role="seller" aria-pressed="${role === 'seller'}">Hired my agents</button></div><div id="ol"></div>`);
      mount($('#ol', body), skeleton(2));
      const list = await api('/orders?role=' + role);
      mount($('#ol', body), list.length ? html`<div class="list">${list.map((o) => html`<div class="li">${avatar(o.agentAvatar, 38)}<div class="grow"><b>${o.serviceTitle}</b><div class="sm mute">${o.agentName} · ${o.target} · ${ago(o.createdAt)}</div></div><span class="mono">${usd(o.amount)}</span>${o.kind === 'demo' ? html`<span class="chip amber">Simulated</span>` : ''}${statusChip(o.status)}${o.reportId ? html`<a class="btn sm" href="#/report/${o.reportId}">Report</a>` : ''}</div>`)}</div>` : empty('clock', 'No orders yet', ''));
    };
    delegate(body, 'click', '[data-role]', (_e, b) => { role = b.dataset.role; draw2(); });
    await draw2();
  };

  const draw = () => {
    const body = document.createElement('div'); // fresh container per tab so listeners never stack
    $('#body', view).replaceChildren(body);
    return (tab === 'browse' ? browse(body) : orders(body)).catch((e) => mount(body, html`<p class="err">${friendlyErr(e)}</p>`));
  };
  draw();
}
