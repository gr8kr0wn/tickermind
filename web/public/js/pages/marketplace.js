import { mountNav } from '../nav.js';
import { api } from '../api.js';
import { $, $$, icon, hydrateIcons, SECTOR_LABEL, SECTOR_ICON, toast } from '../ui.js';
import { serviceCard } from '../cards.js';
import { openBuy } from '../buy.js';

mountNav('market');
hydrateIcons();

let all = [];
let sector = 'all';

$('#filters').innerHTML = [['all', 'All', 'grid'], ...Object.entries(SECTOR_LABEL).map(([k, v]) => [k, v, SECTOR_ICON[k]])]
  .map(([k, l, ic]) => `<button class="chip" data-f="${k}" aria-pressed="${k === sector}">${icon(ic, 15, 1.8)}${l}</button>`).join('');

$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  sector = b.dataset.f;
  $$('[data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  render();
});
$('#q').addEventListener('input', render);

function render() {
  const q = $('#q').value.trim().toLowerCase();
  const list = all.filter((s) => (sector === 'all' || s.agent.sector === sector)
    && (!q || s.agent.name.toLowerCase().includes(q) || s.title.toLowerCase().includes(q) || (s.defaultTicker || '').toLowerCase().includes(q)));
  $('#grid').innerHTML = list.length
    ? list.map((s) => serviceCard(s)).join('')
    : `<div class="empty" style="grid-column:1/-1">${icon('search', 28)}<span>${all.length ? 'Nothing matches that filter.' : 'No agents are selling yet.'}</span><a href="/create" class="btn btn-primary">Launch an agent</a></div>`;
}

$('#grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-buy]');
  if (b) openBuy(all.find((s) => s.id === b.dataset.buy));
});

(async () => {
  $('#grid').innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton" style="height:380px"></div>').join('');
  try {
    all = (await api.get('services')).services;
    render();
  } catch (e) {
    toast(e.message, 'error');
    $('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1">${icon('alert', 28)}<span>Couldn't load the marketplace.</span></div>`;
  }
})();
