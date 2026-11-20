import { api, isSignedIn, friendlyErr } from './api.js';
import { html, mount, ic, avatar, ring, big, usd, ago, skeleton, empty, chip, toast, busy, poll, $, $$, raw } from './ui.js';
import { reportRow, taskTypeLabel } from './components.js';

export async function render(view) {
  mount(view, html`<div class="page-head"><h1 style="font-size:2.2rem">Reports</h1></div><div id="ws"></div><div id="rl">${skeleton(2)}</div>`);
  const [list, me] = await Promise.all([api('/reports'), isSignedIn() ? api('/me').catch(() => null) : null]);

  const mine = (me?.agents || []).filter((a) => a.status === 'active' && a.config.permissions.generateReports);
  if (mine.length) {
    let type = 'company_research';
    mount($('#ws', view), html`<div class="glass pad stack" style="margin-bottom:22px"><h3>Run research</h3>
      <div class="row"><select id="wa" style="width:auto;min-width:180px" aria-label="Agent">${mine.map((a) => html`<option value="${a.id}">${a.name}</option>`)}</select>
        <select id="wt" style="width:auto" aria-label="Type">${Object.entries(taskTypeLabel).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select>
        <input id="wg" placeholder="Ticker or topic, e.g. NVDA" maxlength="60" style="flex:1;min-width:180px" autocomplete="off">
        <button class="btn primary" id="wgo">${ic('bolt')} Start</button></div><div id="wp"></div></div>`);
    $('#wt', view).onchange = (e) => { type = e.target.value; if (type === 'market_summary') $('#wg', view).value = 'US market'; };
    $('#wgo', view).onclick = async (e) => {
      const target = $('#wg', view).value.trim(); if (!target) return toast('Enter a target', 'err');
      try {
        await busy(e.currentTarget, async () => {
          const t = await api(`/agents/${$('#wa', view).value}/tasks`, { method: 'POST', body: { taskType: $('#wt', view).value, target } });
          mount($('#wp', view), html`<div class="row"><span class="spin"></span> Researching. This takes under a minute.</div>`);
          const r = await poll(() => api('/tasks/' + t.id), (x) => ['completed', 'failed'].includes(x.status), { every: 2000 });
          mount($('#wp', view), r.status === 'completed' ? html`<div class="row between"><span class="chip green">${ic('check')} Report ready</span><a class="btn primary sm" href="#/report/${r.reportId}">Open report</a></div>` : html`<p class="err">${r.error || 'The research failed.'}</p>`);
        });
      } catch (err) { toast(friendlyErr(err), 'err'); }
    };
  } else if (isSignedIn()) {
    mount($('#ws', view), html`<div class="glass pad row between" style="margin-bottom:22px"><span class="mute">Create an agent to run your own research.</span><a class="btn primary sm" href="#/create">Create agent</a></div>`);
  }
  mount($('#rl', view), list.length ? html`<div class="list">${list.map(reportRow)}</div>` : empty('doc', 'No reports yet', 'Reports appear here as soon as an agent publishes one.'));
}

const pct = (v) => (v == null ? '–' : (v > 0 ? '+' : '') + v + '%');
const cls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

export async function renderReport(view, id) {
  mount(view, skeleton(2));
  const r = await api('/reports/' + id);
  const x = r.report, f = x.financialSummary || {}, m = x.marketData;
  const px = m && !Array.isArray(m) ? m : null;
  const gen = x.interpretation?.generator || '';
  mount(view, html`<div class="rep">
    <a class="btn sm" href="javascript:history.back()" style="margin:10px 0 18px">Back</a>
    <div class="glass pad"><div class="row" style="gap:18px">
      <div style="flex:1;min-width:220px"><div class="row" style="gap:10px"><h1 style="font-size:2.2rem">${r.company}</h1>${!['INDUSTRY', 'MARKET'].includes(r.ticker) ? chip(r.ticker, 'volt') : ''}</div>
        <a class="row" href="#/agent/${r.agentId}" style="margin-top:10px;gap:8px">${avatar(r.agentAvatar, 28)}<span class="sm">${r.agentName}</span><span class="xs mute">${ago(r.createdAt)}</span></a></div>
      <div class="row">${chip(gen.startsWith('llm') ? 'AI-written' : 'Rule-based', '')}${r.status === 'draft' ? chip('Draft', 'amber') : ''}${ring(r.quality, 64)}<button class="btn sm" onclick="window.print()">${ic('doc')} Print</button></div></div></div>

    ${f.revenue != null || px ? html`<div class="glass pad sec" style="margin-top:16px"><div class="kpis">
      ${f.revenue != null ? html`<div class="kpi"><div class="k">Revenue</div><div class="v mono">${big(f.revenue)}</div><div class="xs mute">${f.reportingPeriod || ''}</div></div>` : ''}
      ${f.revenueGrowthPct != null ? html`<div class="kpi"><div class="k">Revenue growth</div><div class="v mono ${cls(f.revenueGrowthPct)}">${pct(f.revenueGrowthPct)}</div></div>` : ''}
      ${f.netIncome != null ? html`<div class="kpi"><div class="k">Net income</div><div class="v mono">${big(f.netIncome)}</div></div>` : ''}
      ${f.netMarginPct != null ? html`<div class="kpi"><div class="k">Net margin</div><div class="v mono">${f.netMarginPct}%</div></div>` : ''}
      ${px ? html`<div class="kpi"><div class="k">Last close</div><div class="v mono">${px.last}</div><div class="xs mute">${px.asOf}</div></div><div class="kpi"><div class="k">3 months</div><div class="v mono ${cls(px.ret3mPct)}">${pct(px.ret3mPct)}</div></div><div class="kpi"><div class="k">1 year</div><div class="v mono ${cls(px.ret1yPct)}">${pct(px.ret1yPct)}</div></div>` : ''}</div>
      ${px && px.high52 > px.low52 ? html`<div style="margin-top:18px"><div class="row between xs mute"><span>52-week low ${px.low52}</span><span>high ${px.high52}</span></div><div class="range" style="margin-top:8px"><i style="left:calc(${Math.round(((px.last - px.low52) / (px.high52 - px.low52)) * 100)}% - 2px)"></i></div></div>` : ''}</div>` : ''}
    ${Array.isArray(m) ? html`<div class="grid g3" style="margin-top:16px">${m.map((i) => html`<div class="glass pad kpi"><div class="k">${i.ticker} 3 months</div><div class="v mono ${cls(i.ret3mPct)}">${pct(i.ret3mPct)}</div><div class="xs mute">Close ${i.last}</div></div>`)}</div>` : ''}

    <div class="row sec" style="gap:8px;margin-top:20px">
      ${x.dataAsOf?.financials ? chip(`Financials: year ended ${x.dataAsOf.financials} (past)`) : ''}${x.dataAsOf?.price ? chip(`Prices: ${x.dataAsOf.price}`) : ''}${x.dataAsOf?.newsLatest ? chip(`News up to ${x.dataAsOf.newsLatest}`) : ''}</div>

    <div class="glass pad stack" style="margin-top:16px"><h2>Overview</h2><p>${x.overview}</p></div>
    <div class="glass pad stack" style="margin-top:16px"><h2>Recent developments</h2><ul>${x.developments.map((d) => html`<li>${d}</li>`)}</ul><span class="xs mute">Headlines are claims from news sources, not confirmed facts.</span></div>
    <div class="row between sec" style="margin-bottom:-24px"><h2>What the data suggests</h2>${chip('AI interpretation', 'amber')}</div>
    <div class="rep-cols sec"><div class="rep-col bull stack"><h3 class="up">${ic('trend')} Positives</h3><ul>${x.bullishFactors.map((d) => html`<li>${d}</li>`)}</ul></div>
      <div class="rep-col bear stack"><h3 class="down">${ic('warn')} Negatives</h3><ul>${x.bearishFactors.map((d) => html`<li>${d}</li>`)}</ul></div></div>
    <div class="glass pad stack" style="margin-top:16px"><h3>Risks</h3><ul>${x.risks.map((d) => html`<li>${d}</li>`)}</ul><h3 style="margin-top:8px">Conclusion</h3><p>${x.conclusion}</p></div>

    ${x.missingData?.length || x.qualityFlags?.length ? html`<div class="glass pad stack" style="margin-top:16px"><h3>Gaps and checks</h3><div class="row" style="gap:8px">${[...(x.missingData || []), ...(x.qualityFlags || [])].map((t) => chip(t, 'amber'))}</div></div>` : ''}
    <div class="glass pad sec" style="margin-top:16px"><h3 style="margin-bottom:6px">Sources</h3>${r.sources.length ? r.sources.map((s) => html`<div class="src"><a href="${/^https?:\/\//.test(s.url) ? s.url : '#'}" target="_blank" rel="noopener noreferrer">${s.title}</a><span class="xs mute" style="margin-left:auto;white-space:nowrap">${s.publishedAt ? 'published ' + s.publishedAt + ' · ' : ''}fetched ${(s.retrievedAt || '').slice(0, 10)}</span></div>`) : html`<p class="mute sm">No sources could be retrieved for this report.</p>`}</div>
    <p class="xs mute" style="margin-top:18px">${chip('Sandbox', 'amber')} ${x.disclaimer}</p></div>`);
}
