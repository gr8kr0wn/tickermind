import { api, state, isSignedIn, connect, registerAgentOnchain, friendlyErr } from './api.js';
import { html, mount, ic, avatar, toast, busy, SPECS, PERMS, $, $$, delegate, raw } from './ui.js';

const COL = ['#6EA8FF', '#A3E635', '#F5B83D'];

export function render(view) {
  const d = { name: '', description: '', avatar: Math.floor(Math.random() * 12), specialization: 'technology', targets: ['NVDA'], freq: 'on_demand', perms: Object.fromEntries(PERMS.map(([k]) => [k, true])), r: 40, s: 40, onchain: true };
  let step = 0;
  const onchainPossible = () => state.config.chainEnabled && !!window.ethereum;

  const wizard = () => html`<div class="wiz">${['Identity', 'Focus', 'Rules'].map((l, i) => html`<div class="w ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}"><b>${i < step ? ic('check') : i + 1}</b>${l}</div>${i < 2 ? raw('<span class="bar"></span>') : ''}`)}</div>`;

  const paint = () => {
    mount(view, html`<div class="page-head"><h1 style="font-size:2.2rem">Create agent</h1></div>${wizard()}<div class="glass pad" style="max-width:760px" id="card"></div>`);
    const c = $('#card', view);
    if (step === 0) {
      mount(c, html`<div class="stack"><label class="f">Name<input id="name" maxlength="40" value="${d.name}" placeholder="Chip Hunter" autocomplete="off"></label>
        <label class="f">What does it do?<textarea id="desc" maxlength="280" placeholder="Follows semiconductor companies and writes short reports.">${d.description}</textarea></label>
        <div class="f" style="display:grid;gap:8px"><span>Look</span><div class="row" style="gap:10px">${Array.from({ length: 12 }, (_, i) => html`<button class="pick-tile" data-av="${i}" aria-pressed="${i === d.avatar}" aria-label="Look ${i + 1}" style="padding:8px;width:64px">${avatar(i, 44)}</button>`)}</div></div>
        <div class="row between"><span></span><button class="btn primary" id="next">Next</button></div></div>`);
      $('#name', c).oninput = (e) => (d.name = e.target.value); $('#desc', c).oninput = (e) => (d.description = e.target.value);
      delegate(c, 'click', '[data-av]', (_e, b) => { d.avatar = Number(b.dataset.av); $$('[data-av]', c).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
      $('#next', c).onclick = () => { if (d.name.trim().length < 2) return toast('Give your agent a name', 'err'); step = 1; paint(); };
    } else if (step === 1) {
      const sug = SPECS[d.specialization].targets;
      const chips = () => html`${d.targets.map((t) => html`<button class="chip volt" data-rm="${t}" title="Remove">${t} ${ic('x')}</button>`)}${!d.targets.length ? html`<span class="mute sm">Add a few tickers or topics</span>` : ''}`;
      mount(c, html`<div class="stack"><div class="f" style="display:grid;gap:8px"><span>Focus</span><div class="pick-grid">${Object.entries(SPECS).map(([k, v]) => html`<button class="pick-tile" data-spec="${k}" aria-pressed="${k === d.specialization}">${ic(v.icon)}${v.label}</button>`)}</div></div>
        <div class="f" style="display:grid;gap:8px"><span>Watching</span><div class="row" id="chips">${chips()}</div>
          <div class="row"><input id="tin" placeholder="Add ticker, e.g. NVDA" maxlength="40" style="max-width:240px" autocomplete="off"><button class="btn sm" id="tadd">Add</button></div>
          <div class="row" id="sug">${sug.map((t) => html`<button class="chip pick" data-sug="${t}" aria-pressed="${d.targets.includes(t)}">${t}</button>`)}</div></div>
        <div class="f" style="display:grid;gap:8px"><span>How often</span><div class="row">${[['on_demand', 'When asked'], ['daily', 'Daily'], ['weekly', 'Weekly']].map(([k, l]) => html`<button class="chip pick" data-freq="${k}" aria-pressed="${d.freq === k}">${l}</button>`)}</div></div>
        <div class="row between"><button class="btn" id="back">Back</button><button class="btn primary" id="next">Next</button></div></div>`);
      const redraw = () => { mount($('#chips', c), chips()); $$('[data-sug]', c).forEach((b) => b.setAttribute('aria-pressed', String(d.targets.includes(b.dataset.sug)))); };
      const add = (t) => { t = t.trim().toUpperCase(); if (t && !d.targets.includes(t) && d.targets.length < 10) d.targets.push(t); redraw(); };
      delegate(c, 'click', '[data-spec]', (_e, b) => { d.specialization = b.dataset.spec; paint(); });
      delegate(c, 'click', '[data-rm]', (_e, b) => { d.targets = d.targets.filter((t) => t !== b.dataset.rm); redraw(); });
      delegate(c, 'click', '[data-sug]', (_e, b) => { const t = b.dataset.sug; d.targets.includes(t) ? (d.targets = d.targets.filter((x) => x !== t)) : add(t); redraw(); });
      delegate(c, 'click', '[data-freq]', (_e, b) => { d.freq = b.dataset.freq; $$('[data-freq]', c).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
      $('#tadd', c).onclick = () => { add($('#tin', c).value); $('#tin', c).value = ''; };
      $('#tin', c).onkeydown = (e) => { if (e.key === 'Enter') { add(e.target.value); e.target.value = ''; } };
      $('#back', c).onclick = () => { step = 0; paint(); }; $('#next', c).onclick = () => { step = 2; paint(); };
    } else {
      mount(c, html`<div class="stack"><div class="f" style="display:grid;gap:8px"><span>Allowed to</span><div class="grid g2" style="gap:8px">${PERMS.map(([k, l, i]) => html`<button class="switch-tile" data-perm="${k}" aria-pressed="${d.perms[k]}">${ic(i)}<span>${l}</span><span class="sw"></span></button>`)}</div></div>
        <div class="f" style="display:grid;gap:8px"><span>Split every payment</span><div class="split" id="split" role="group" aria-label="Allocation"></div><div class="legend" id="legend"></div>
          <div class="row">${[['Balanced', 40, 40], ['Safe', 60, 20], ['Growth', 20, 60]].map(([n, r, s]) => html`<button class="chip pick" data-preset="${r},${s}" aria-pressed="false">${n}</button>`)}</div></div>
        ${onchainPossible() ? html`<button class="switch-tile" id="oc" aria-pressed="${d.onchain}">${ic('shield')}<span>Register on Base Sepolia<br><span class="xs mute">Needs a little test ETH for gas</span></span><span class="sw"></span></button>` : html`<p class="xs mute">${state.config.chainEnabled ? 'No wallet found, so this agent will not be registered onchain.' : 'Onchain registration is not set up on this server.'}</p>`}
        <div class="row between"><button class="btn" id="back">Back</button><button class="btn primary" id="deploy">${ic('bolt')} Deploy agent</button></div></div>`);
      splitBar($('#split', c), $('#legend', c), d);
      delegate(c, 'click', '[data-perm]', (_e, b) => { const k = b.dataset.perm; d.perms[k] = !d.perms[k]; b.setAttribute('aria-pressed', String(d.perms[k])); });
      delegate(c, 'click', '[data-preset]', (_e, b) => { const [r, s] = b.dataset.preset.split(',').map(Number); d.r = r; d.s = s; splitBar($('#split', c), $('#legend', c), d); });
      $('#oc', c)?.addEventListener('click', (e) => { d.onchain = !d.onchain; e.currentTarget.setAttribute('aria-pressed', String(d.onchain)); });
      $('#back', c).onclick = () => { step = 1; paint(); };
      $('#deploy', c).onclick = (e) => deploy(e.currentTarget);
    }
  };

  async function deploy(btn) {
    const label = btn.innerHTML;
    try {
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Signing in…';
      if (!isSignedIn()) await connect();
      let registerTx;
      if (onchainPossible() && d.onchain) {
        btn.innerHTML = '<span class="spin"></span> Confirm in wallet…';
        registerTx = await registerAgentOnchain({ name: d.name.trim(), specialization: d.specialization });
      }
      btn.innerHTML = '<span class="spin"></span> Saving…';
      const a = await api('/agents', { method: 'POST', body: { name: d.name, description: d.description, specialization: d.specialization, avatar: d.avatar, researchTargets: d.targets, researchFrequency: d.freq, permissions: d.perms, allocationPolicy: { reservePercentage: d.r, simulatedStockPercentage: d.s, operatingPercentage: 100 - d.r - d.s }, registerTx } });
      toast('Agent deployed', 'ok');
      location.hash = '#/agent/' + a.id;
    } catch (e) { toast(friendlyErr(e), 'err'); btn.disabled = false; btn.innerHTML = label; }
  }
  paint();
}

// Two draggable handles that always add up to exactly 100%.
function splitBar(bar, legend, d) {
  const segs = [['Reserve', d.r], ['Practice stocks', d.s], ['Operating', 100 - d.r - d.s]];
  mount(bar, html`${segs.map(([l, v], i) => html`<div class="seg" style="width:${v}%;background:${COL[i]}">${v >= 12 ? v + '%' : ''}</div>`)}<div class="hd" role="slider" tabindex="0" aria-label="Reserve share" aria-valuenow="${d.r}" data-h="0" style="left:${d.r}%"></div><div class="hd" role="slider" tabindex="0" aria-label="Operating share starts" aria-valuenow="${d.r + d.s}" data-h="1" style="left:${d.r + d.s}%"></div>`);
  mount(legend, html`${segs.map(([l, v], i) => html`<span><i style="background:${COL[i]}"></i>${l} ${v}%</span>`)}`);
  const set = (h, pct) => {
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    if (h === 0) { const edge = d.r + d.s; d.r = Math.min(pct, edge); d.s = edge - d.r; }
    else { const edge = Math.max(pct, d.r); d.s = edge - d.r; }
    splitBar(bar, legend, d);
    bar.querySelector(`[data-h="${h}"]`)?.focus();
  };
  bar.querySelectorAll('.hd').forEach((el) => {
    const h = Number(el.dataset.h);
    el.onpointerdown = (e) => {
      e.preventDefault(); el.setPointerCapture(e.pointerId);
      const move = (ev) => { const rect = bar.getBoundingClientRect(); set(h, ((ev.clientX - rect.left) / rect.width) * 100); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    el.onkeydown = (e) => { const cur = h === 0 ? d.r : d.r + d.s; if (e.key === 'ArrowLeft') { e.preventDefault(); set(h, cur - 1); } if (e.key === 'ArrowRight') { e.preventDefault(); set(h, cur + 1); } };
  });
}
