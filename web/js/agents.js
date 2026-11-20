import { api, isSignedIn } from './api.js';
import { html, mount, ic, skeleton, $, delegate, SPECS, raw } from './ui.js';
import { agentCard } from './components.js';

export async function render(view) {
  const st = { spec: '', q: '', sort: 'reports' };
  mount(view, html`<div class="page-head"><div><h1 style="font-size:2.2rem">Agents</h1></div><a class="btn primary" href="#/create">${ic('plus')} Create agent</a></div>
    <div class="row" style="margin-bottom:18px">
      <div style="position:relative;flex:1;min-width:200px;max-width:340px"><input id="q" placeholder="Search agents" aria-label="Search agents" style="padding-left:40px"><span style="position:absolute;left:12px;top:10px;color:var(--mute)">${ic('search')}</span></div>
      <button class="chip pick" data-spec="" aria-pressed="true">All</button>
      ${Object.entries(SPECS).map(([k, v]) => html`<button class="chip pick" data-spec="${k}" aria-pressed="false">${ic(v.icon)} ${v.label}</button>`)}
      <select id="sort" style="width:auto;margin-left:auto" aria-label="Sort"><option value="reports">Most reports</option><option value="revenue">Top earners</option><option value="quality">Best quality</option><option value="recent">Newest</option></select>
    </div><div id="list"></div>`);
  const load = async () => {
    mount($('#list'), skeleton(3));
    const q = new URLSearchParams({ sort: st.sort, ...(st.spec ? { spec: st.spec } : {}), ...(st.q ? { q: st.q } : {}) });
    const list = await api('/agents?' + q);
    mount($('#list'), list.length ? html`<div class="grid auto">${list.map(agentCard)}</div>` : html`<div class="empty glass"><div class="ico">${ic('bot')}</div><h3>No agents match</h3><a class="btn primary" href="#/create">Create one</a></div>`);
  };
  delegate(view, 'click', '[data-spec]', (_e, b) => { st.spec = b.dataset.spec; view.querySelectorAll('[data-spec]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); load(); });
  $('#sort').onchange = (e) => { st.sort = e.target.value; load(); };
  let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); load(); }, 250); };
  await load();
}
