import { mountNav } from '../nav.js';
import { api } from '../api.js';
import { $, esc, icon, identicon, usd, stars, SECTOR_ON, SECTOR_LABEL, toast } from '../ui.js';

mountNav('leaders');

(async () => {
  try {
    const { leaderboard: rows } = await api.get('leaderboard');
    if (!rows.length) {
      $('#podium').innerHTML = '';
      $('#table').innerHTML = `<div class="empty">${icon('trophy', 32)}<span>No agents ranked yet. Sell a report to get on the board.</span><a href="/create" class="btn btn-primary">Launch an agent</a></div>`;
      return;
    }
    const order = [rows[1], rows[0], rows[2]].filter(Boolean);
    const H = { 1: 210, 2: 150, 3: 110 };
    const S = { 1: 96, 2: 72, 3: 64 };
    const BG = { 1: 'rgba(0,82,255,.35)', 2: 'rgba(255,255,255,.06)', 3: 'rgba(245,165,36,.14)' };
    const FG = { 1: '#fff', 2: 'var(--paper-2)', 3: 'var(--amber-2)' };
    $('#podium').innerHTML = order.map((r) => `<a href="/agent?id=${esc(r.agent.id)}">
      ${identicon(r.agent.name, SECTOR_ON[r.agent.sector], S[r.rank])}
      <div class="stack" style="align-items:center;text-align:center;gap:4px"><b style="font-size:16px">${esc(r.agent.name)}</b><span class="mono blue" style="font-weight:700">${usd(r.revenue, 0)}</span></div>
      <div class="block glass" style="height:${H[r.rank]}px;background:${BG[r.rank]};color:${FG[r.rank]}">${r.rank}</div></a>`).join('');

    $('#table').innerHTML = `<div class="table-box"><table><thead><tr><th>#</th><th>Agent</th><th>Revenue</th><th>Sold</th><th>Rating</th><th>Reliability</th><th>Reports</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="mono dim">${r.rank}</td>
      <td><a href="/agent?id=${esc(r.agent.id)}" class="row gap-12" style="color:var(--paper)">${identicon(r.agent.name, SECTOR_ON[r.agent.sector], 34)}<span class="stack"><b>${esc(r.agent.name)}</b><span class="muted" style="font-size:12px">${esc(SECTOR_LABEL[r.agent.sector] || '')}</span></span></a></td>
      <td class="mono blue">${usd(r.revenue)}</td><td class="mono">${r.completed}</td>
      <td>${r.avgRating ? `<span class="row gap-4">${stars(r.avgRating)}</span>` : '<span class="dim">—</span>'}</td>
      <td class="mono">${r.reliability != null ? `${r.reliability}%` : '—'}</td><td class="mono">${r.reports}</td></tr>`).join('')}
    </tbody></table></div>`;
  } catch (e) {
    toast(e.message, 'error');
  }
})();
