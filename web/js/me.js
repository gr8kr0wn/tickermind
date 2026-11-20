import { api, state, isSignedIn, connect, signOut, friendlyErr } from './api.js';
import { html, mount, ic, avatar, donut, usd, short, ago, toast, busy, skeleton, empty, $, $$, delegate } from './ui.js';
import { agentCard, statusChip, taskTypeLabel } from './components.js';

export async function render(host) {
  const view = document.createElement('div'); // fresh container each render so listeners never stack
  host.replaceChildren(view);
  if (!isSignedIn()) {
    return mount(view, html`<div class="empty glass" style="margin-top:40px"><div class="ico">${ic('wallet')}</div><h2>Your dashboard</h2><p class="sm">Connect a wallet to see your agents, earnings and orders.</p><button class="btn primary" id="c">${ic('wallet')} Connect wallet</button></div>`),
      ($('#c', view).onclick = async (e) => { try { await busy(e.currentTarget, connect); } catch (err) { toast(friendlyErr(err), 'err'); } });
  }
  mount(view, skeleton(3));
  const me = await api('/me');
  // pending approvals for agent-to-agent hires
  const pending = (await Promise.all(me.agents.map((a) => api('/a2a?agentId=' + a.id)))).flat().filter((x) => x.status === 'pending_approval' && me.agents.some((a) => a.id === x.from.id));
  const t = me.totals;

  mount(view, html`<div class="page-head"><div><h1 style="font-size:2.2rem">Dashboard</h1><span class="mono sm mute">${short(me.wallet)}</span></div>
      <div class="row"><a class="btn primary" href="#/create">${ic('plus')} Create agent</a><button class="btn" id="out">${ic('logout')} Sign out</button></div></div>
    ${pending.length ? html`<div class="glass pad stack" style="margin-bottom:22px;border-color:rgba(245,184,61,.4)"><h3>${ic('bell')} Waiting for your approval</h3>${pending.map((p) => html`<div class="li"><div class="grow"><b>${p.from.name}</b> wants to hire <b>${p.to.name}</b> for <span class="mono">${usd(p.amount)} USDC</span><div class="xs mute">${p.serviceTitle} · ${p.target}</div></div><button class="btn sm primary" data-ok="${p.id}">Approve</button><button class="btn sm" data-no="${p.id}">Reject</button></div>`)}</div>` : ''}
    <div class="grid g4">${[['bot', t.agents, 'Agents'], ['bolt', t.active, 'Active'], ['doc', t.reports, 'Reports'], ['coin', usd(t.revenue), 'USDC earned']].map(([i, n, l]) => html`<div class="glass stat"><div class="ico">${ic(i)}</div><div><div class="n mono">${n}</div><div class="sm mute">${l}</div></div></div>`)}</div>
    <section class="sec"><h2>My agents</h2>${me.agents.length ? html`<div class="grid auto">${me.agents.map(agentCard)}</div>` : empty('bot', 'No agents yet', 'Create your first research agent.', html`<a class="btn primary" href="#/create">Create agent</a>`)}</section>
    ${me.activity.length ? html`<section class="sec"><h2>Recent work</h2><div class="list">${me.activity.map((a) => html`<div class="li">${avatar(a.agent.avatar, 34)}<div class="grow"><b>${a.target}</b> <span class="sm mute">${taskTypeLabel[a.type]} · ${a.agent.name}</span></div><span class="xs mute">${ago(a.at)}</span>${statusChip(a.status)}${a.reportId ? html`<a class="btn sm" href="#/report/${a.reportId}">Open</a>` : ''}</div>`)}</div></section>` : ''}
    <section class="sec"><h2>Settings</h2><div class="glass pad stack"><div class="row between"><span>Wallet</span><span class="mono sm">${me.wallet}</span></div><div class="row between"><span>Network</span><span class="chip volt">Base Sepolia (${state.config.chainId})</span></div>
      <div class="row between"><span>Mode</span><span class="chip amber">${state.config.demoMode ? 'Sandbox with simulated payments' : 'Sandbox'}</span></div>
      ${state.config.explorer ? html`<a class="btn sm" style="width:max-content" href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer">${ic('external')} Get test USDC</a>` : ''}</div></section>`);

  $('#out', view).onclick = () => { signOut(); toast('Signed out'); };
  delegate(view, 'click', '[data-ok]', async (_e, b) => { try { await busy(b, () => api(`/a2a/${b.dataset.ok}/approve`, { method: 'POST' })); toast('Approved. The agent is researching.', 'ok'); render(host); } catch (e) { toast(friendlyErr(e), 'err'); } });
  delegate(view, 'click', '[data-no]', async (_e, b) => { try { await busy(b, () => api(`/a2a/${b.dataset.no}/reject`, { method: 'POST' })); render(host); } catch (e) { toast(friendlyErr(e), 'err'); } });
}
