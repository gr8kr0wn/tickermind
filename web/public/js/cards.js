// Reusable card markup for agents and services.
import { esc, identicon, icon, pad, SECTOR_ON, SECTOR_LABEL, STRATEGY_LABEL, stars, usd } from './ui.js';

export function serviceCard(s, { buyLabel = 'Request' } = {}) {
  const sector = s.agent.sector;
  return `<article class="tcard" data-sector="${esc(sector)}">
    <a href="/agent?id=${esc(s.agent.id)}" class="tcard-top tint" aria-label="View ${esc(s.agent.name)}">
      <span class="corner" style="left:16px">${pad(s.agent.onchainId)}</span>
      ${identicon(s.agent.name, SECTOR_ON[sector], 108)}
      <span class="price glass">${esc(s.price)} USDC</span>
    </a>
    <div class="tcard-body">
      <div class="stack gap-8">
        <h3 style="font-size:21px;letter-spacing:-.02em">${esc(s.agent.name)}</h3>
        <span class="muted" style="font-size:15px">${esc(s.title)}</span>
      </div>
      <div class="wrap-row gap-8">
        <span class="tag">${icon('tag', 12)}${esc(SECTOR_LABEL[sector] || sector)}</span>
        ${s.defaultTicker ? `<span class="tag tag-blue">${esc(s.defaultTicker)}</span>` : '<span class="tag">Any ticker</span>'}
      </div>
      <div class="row between gap-12" style="margin-top:auto">
        <span class="row gap-8 mono muted" style="font-size:13px">${s.stats.avgRating ? `${stars(s.stats.avgRating)}` : `${icon('check', 14)} ${s.stats.completed} delivered`}</span>
        <button class="btn btn-paper btn-sm" data-buy="${esc(s.id)}">${esc(buyLabel)}</button>
      </div>
    </div>
  </article>`;
}

export function agentCard(a) {
  const t = a.treasury;
  const p = t?.policy || a.policy;
  return `<a href="/agent?id=${esc(a.id)}" class="tcard" data-sector="${esc(a.sector)}" style="color:inherit">
    <div class="tcard-top tint" style="height:160px">
      <span class="corner" style="left:16px">${pad(a.onchainId)}</span>
      <span class="corner" style="right:16px">${esc(STRATEGY_LABEL[a.strategy] || '')}</span>
      ${identicon(a.name, SECTOR_ON[a.sector], 96)}
    </div>
    <div class="tcard-body">
      <div class="row between gap-12"><h3 style="font-size:20px">${esc(a.name)}</h3><span class="tag">${esc(SECTOR_LABEL[a.sector] || a.sector)}</span></div>
      <div class="stack gap-4"><span class="muted" style="font-size:13px">Treasury</span><b class="mono" style="font-size:30px;letter-spacing:-.03em">${t && !t.error ? usd(t.balance) : '—'}</b></div>
      <div class="splitbar" style="height:8px"><span class="fill-real" style="flex-grow:${p.reserve}"></span><span class="fill-ops" style="flex-grow:${p.operating}"></span><span class="hatch" style="flex-grow:${p.simulated}"></span></div>
      <div class="row gap-16 mono muted" style="font-size:13px"><span>${a.stats?.reports ?? 0} reports</span><span>${a.stats?.completed ?? 0} sold</span></div>
    </div>
  </a>`;
}
