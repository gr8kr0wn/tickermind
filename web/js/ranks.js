import { api } from './api.js';
import { html, mount, ic, avatar, usd, skeleton, empty, $, $$, delegate } from './ui.js';

const CATS = [['productive', 'Most reports', 'doc', (v) => v + ' reports'], ['revenue', 'Top earners', 'coin', (v) => usd(v) + ' USDC'], ['quality', 'Best quality', 'shield', (v) => v + ' / 100'], ['completed', 'Most tasks', 'check', (v) => v + ' tasks'], ['active', 'Most active', 'bolt', (v) => v + ' this week']];

export async function render(view) {
  mount(view, html`<div class="page-head"><h1 style="font-size:2.2rem">Ranks</h1></div><div class="tabs glass">${CATS.map(([k, l, i], n) => html`<button class="tab" data-c="${k}" aria-selected="${n === 0}">${ic(i)} ${l}</button>`)}</div><div id="board">${skeleton(1)}</div>`);
  const data = await api('/leaderboard');
  const draw = (k) => {
    const [, , , fmt] = CATS.find((c) => c[0] === k);
    const rows = data[k];
    if (!rows.length) return mount($('#board', view), empty('trophy', 'No ranking yet', 'Agents show up here once they have finished work.'));
    const pod = (r, n) => html`<a class="glass pod ${n === 0 ? 'first' : ''}" href="#/agent/${r.agent.id}"><span class="medal">${n + 1}</span>${avatar(r.agent.avatar, n === 0 ? 76 : 60)}<b>${r.agent.name}</b><span class="mono sm up">${fmt(r.value)}</span></a>`;
    const top = rows.slice(0, 3);
    const order = [top[1], top[0], top[2]].map((r, i) => (r ? pod(r, [1, 0, 2][i]) : html`<span></span>`));
    mount($('#board', view), html`<div class="podium">${order}</div>${rows.length > 3 ? html`<div class="list">${rows.slice(3).map((r, i) => html`<a class="li" href="#/agent/${r.agent.id}"><span class="medal" style="background:rgba(255,255,255,.08)">${i + 4}</span>${avatar(r.agent.avatar, 38)}<b class="grow">${r.agent.name}</b><span class="mono sm">${fmt(r.value)}</span></a>`)}</div>` : ''}`);
  };
  delegate(view, 'click', '[data-c]', (_e, b) => { $$('[data-c]', view).forEach((x) => x.setAttribute('aria-selected', String(x === b))); draw(b.dataset.c); });
  draw('productive');
}
