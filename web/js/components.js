import { html, ic, avatar, ring, usd, statusDot, SPECS, chip, ago, raw } from './ui.js';

export const specOf = (k) => SPECS[k] || SPECS.general;

export const agentCard = (a) => html`<a class="acard glass" href="#/agent/${a.id}">
  <div class="head">${avatar(a.avatar, 52)}
    <div style="min-width:0"><h3>${a.name}</h3><span class="spec">${ic(specOf(a.specialization).icon)} ${specOf(a.specialization).label} ${statusDot(a.status)}</span></div>
    <span style="margin-left:auto">${ring(a.stats.quality, 44)}</span></div>
  <p class="sm mute" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.6em">${a.description || 'Research agent'}</p>
  <div class="mini"><div><span class="k">Reports</span><span class="v">${a.stats.reports}</span></div>
    <div><span class="k">Earned</span><span class="v mono">${usd(a.stats.revenue)}</span></div>
    <div><span class="k">Deals</span><span class="v">${a.stats.orders}</span></div></div>
  ${a.demo ? chip('Demo agent', 'volt') : ''}</a>`;

export const reportRow = (r) => html`<a class="li" href="#/report/${r.id}">
  ${avatar(r.agentAvatar, 38)}
  <div class="grow"><b>${r.company}</b> <span class="mute sm">${r.ticker && !['INDUSTRY', 'MARKET'].includes(r.ticker) ? r.ticker : ''}</span>
    <div class="sm mute" style="white-space:nowrap">${r.overview}</div></div>
  <div style="text-align:right" class="xs mute">${r.agentName}<br>${ago(r.createdAt)}</div>${ring(r.quality, 38)}</a>`;

export const statusLabel = { pending_payment: 'Waiting for payment', paid: 'Paid', processing: 'Researching', delivered: 'Delivered', completed: 'Done', refunded: 'Refunded', pending: 'Queued', failed: 'Failed', pending_approval: 'Needs approval', approved: 'Researching', rejected: 'Rejected' };
export const statusChip = (s) => html`<span class="chip ${['completed', 'delivered'].includes(s) ? 'green' : ['failed', 'refunded', 'rejected'].includes(s) ? 'red' : ['pending_approval', 'pending_payment'].includes(s) ? 'amber' : 'volt'}">${statusLabel[s] || s}</span>`;

export const taskTypeLabel = { company_research: 'Company research', earnings_analysis: 'Earnings', industry_analysis: 'Industry', market_summary: 'Market summary' };
export const catLabel = { company_research: 'Company', earnings_analysis: 'Earnings', industry_research: 'Industry', market_intelligence: 'Market' };
export const catIcon = { company_research: 'layers', earnings_analysis: 'chart', industry_research: 'layers', market_intelligence: 'globe' };
export const catHint = { company_research: 'Ticker or name, e.g. NVDA', earnings_analysis: 'Ticker or name, e.g. LLY', industry_research: 'Industry, e.g. semiconductors', market_intelligence: '' };
export const none = raw('');
