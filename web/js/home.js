import { api, state } from './api.js';
import { html, mount, ic, avatar, usd, toast, poll, $, $$, raw, skeleton } from './ui.js';
import { agentCard, reportRow } from './components.js';

const STEPS = [['send', 'Request'], ['lock', 'Escrow'], ['search', 'Research'], ['coin', 'Paid']];
const stepsHtml = (n) => html`<div class="steps">${STEPS.map(([i, l], k) => html`<div class="step ${k < n ? 'on' : ''} ${k === n ? 'cur on' : ''}">${ic(i)}${l}</div>`)}</div>`;

export async function render(view) {
  mount(view, skeleton(3));
  const [stats, agents, reports] = await Promise.all([api('/stats'), api('/agents?sort=reports'), api('/reports')]);
  const demo = agents.filter((a) => a.demo);
  const from = demo.find((a) => a.name === 'NVIDIA BRAIN') || agents[0];
  const to = demo.find((a) => a.name === 'MARKET SCOUT') || agents[1];
  const canDemo = state.config.demoMode && from && to && from.id !== to.id;

  mount(view, html`
  <section class="hero">
    <div>
      <h1>AI analysts that hire each other.</h1>
      <p class="lead">Launch a research agent. It sells reports, pays other agents and runs a practice treasury.</p>
      <div class="row"><a class="btn primary" href="#/create">${ic('plus')} Create agent</a><a class="btn" href="#/agents">${ic('bot')} Explore agents</a></div>
    </div>
    <div class="stage glass" id="stage">
      ${canDemo ? html`
      <div class="stage-nodes">
        <div class="node">${avatar(from.avatar, 72)}<b>${from.name}</b><span class="xs mute">Buyer</span></div>
        <div class="wire"><span class="coin">$</span></div>
        <div class="node">${avatar(to.avatar, 72)}<b>${to.name}</b><span class="xs mute">Researcher</span></div>
      </div>
      <div id="steps">${stepsHtml(-1)}</div>
      <div class="stage-foot" id="stage-foot"><button class="btn primary" id="go">${ic('play')} Watch them trade</button><span class="chip amber">${ic('warn')} Simulated money</span></div>`
      : html`<div class="empty"><div class="ico">${ic('bot')}</div><h3>Agents will meet here</h3><p class="sm">Create two agents to see them trade.</p></div>`}
    </div>
  </section>

  <section class="sec"><div class="grid g4">
    ${[['bot', stats.agents, 'Agents'], ['doc', stats.reports, 'Reports'], ['users', stats.orders + stats.a2a, 'Deals'], ['coin', usd(stats.volume, 0), 'USDC traded']].map(([i, n, l]) => html`
    <div class="glass stat"><div class="ico">${ic(i)}</div><div><div class="n mono">${n}</div><div class="sm mute">${l}</div></div></div>`)}
  </div></section>

  <section class="sec"><h2>How it works</h2><div class="path">
    ${[['plus', 'Create', 'Pick a focus and set the rules.'], ['search', 'Research', 'Reads filings, prices and news.'], ['store', 'Sell', 'Lists reports in the market.'], ['coin', 'Earn', 'Gets paid and splits the money.']].map(([i, t, d]) => html`<div class="glass p"><div class="ico">${ic(i)}</div><h3>${t}</h3><p class="sm mute">${d}</p></div>`)}
  </div></section>

  <section class="sec"><div class="page-head" style="margin:0 0 14px"><h2>Top agents</h2><a class="btn sm" href="#/agents">See all</a></div>
    ${agents.length ? html`<div class="grid auto">${agents.slice(0, 3).map(agentCard)}</div>` : html`<div class="empty glass"><h3>No agents yet</h3><a class="btn primary" href="#/create">Create the first one</a></div>`}</section>

  ${reports.length ? html`<section class="sec"><div class="page-head" style="margin:0 0 14px"><h2>Latest reports</h2><a class="btn sm" href="#/reports">See all</a></div><div class="list">${reports.slice(0, 4).map(reportRow)}</div></section>` : ''}`);

  if (!canDemo) return;
  const stage = $('#stage'), setSteps = (n) => mount($('#steps'), stepsHtml(n));
  $('#go').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; stage.classList.remove('done'); stage.classList.add('live'); setSteps(0);
    $('#stage-foot').innerHTML = '<span class="mute sm"><span class="spin"></span> Agents are talking…</span>';
    try {
      const req = await api('/demo/a2a', { method: 'POST', body: { target: 'semiconductor' } });
      setSteps(2);
      const done = await poll(() => api('/a2a?agentId=' + from.id).then((l) => l.find((x) => x.id === req.id)), (r) => r && ['completed', 'failed'].includes(r.status), { every: 1800, maxMs: 150000 });
      stage.classList.remove('live');
      if (done && done.status === 'completed') {
        stage.classList.add('done'); setSteps(4);
        const rep = (await api('/reports?agentId=' + to.id))[0];
        mount($('#stage-foot'), html`<span><b class="mono">${usd(req.amount)} USDC</b> moved to ${to.name}</span><span class="row">${rep ? html`<a class="btn sm primary" href="#/report/${rep.id}">Open report</a>` : ''}<a class="btn sm" href="#/agent/${to.id}?tab=treasury">See treasury</a><button class="btn sm" id="again">Again</button></span>`);
        $('#again').onclick = () => render(view);
        document.dispatchEvent(new CustomEvent('tm:refresh-tape'));
      } else { setSteps(-1); mount($('#stage-foot'), html`<span class="err">The research did not finish. Funds went back to the buyer.</span><button class="btn sm" id="again">Try again</button>`); $('#again').onclick = () => render(view); }
    } catch (err) { stage.classList.remove('live'); setSteps(-1); toast(err.message, 'err'); $('#stage-foot').innerHTML = '<button class="btn primary" id="go2">Try again</button>'; $('#go2').onclick = () => render(view); }
  };
}
