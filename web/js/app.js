import { api, state, loadConfig, connect, signOut, onSession, isSignedIn } from './api.js';
import { html, mount, ic, avatar, usd, short, toast, $, $$, raw } from './ui.js';
import { friendlyErr } from './api.js';

const ROUTES = [
  [/^$/, 'home'], [/^agents$/, 'agents'], [/^agent\/([\w-]+)$/, 'agent'], [/^create$/, 'create'], [/^market$/, 'market'],
  [/^reports$/, 'reports'], [/^report\/([\w-]+)$/, 'report'], [/^ranks$/, 'ranks'], [/^me$/, 'me'],
];
const NAV = [['#/', 'home', 'Home', ['home']], ['#/agents', 'bot', 'Agents', ['agents', 'agent', 'create']], ['#/market', 'store', 'Market', ['market']], ['#/reports', 'doc', 'Reports', ['reports', 'report']], ['#/ranks', 'trophy', 'Ranks', ['ranks']], ['#/me', 'wallet', 'Me', ['me']]];
const view = $('#view');
let cleanup = null, token = 0;

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

function drawDock(name) {
  mount($('#dock'), html`<a class="logo" href="#/" aria-label="TickerMind home"><svg class="i" viewBox="0 0 24 24"><path d="M4 17l5-6 4 3 7-9" style="stroke-width:2.4"/></svg></a>
    ${NAV.map(([href, icon, label, names]) => html`<a href="${href}" ${names.includes(name) ? raw('aria-current="page"') : ''}>${ic(icon)}<span>${label}</span></a>`)}
    <span class="grow"></span>`);
}

async function route() {
  const my = ++token;
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const { path, query } = parseHash();
  let name = 'home', params = [];
  for (const [re, n] of ROUTES) { const m = path.match(re); if (m) { name = n; params = m.slice(1); break; } }
  drawDock(name);
  window.scrollTo(0, 0);
  try {
    const mod = await import(`./${name === 'report' ? 'reports' : name}.js`);
    if (my !== token) return;
    const fn = name === 'report' ? mod.renderReport : mod.render;
    // fresh container per route so event listeners from earlier pages can never leak into this one
    const root = document.createElement('div');
    view.replaceChildren(root);
    const out = await fn(root, ...params, query);
    if (my === token && typeof out === 'function') cleanup = out;
  } catch (e) {
    console.error(e);
    mount(view, html`<div class="empty glass"><div class="ico">${ic('warn')}</div><h3>That did not load</h3><p class="sm">${e.message}</p><button class="btn" onclick="location.reload()">Reload</button></div>`);
  }
  view.focus({ preventScroll: true });
}

function drawAccount() {
  const el = $('#account');
  if (isSignedIn()) {
    mount(el, html`<a class="btn sm" href="#/me" title="Your dashboard"><span class="dot active"></span><span class="mono">${short(state.wallet)}</span></a>`);
  } else {
    mount(el, html`<button class="btn primary sm" id="connect">${ic('wallet')} Connect</button>`);
    $('#connect').onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await connect(); toast('Wallet connected', 'ok'); } catch (err) { toast(friendlyErr(err), 'err'); b.disabled = false; }
    };
  }
}

async function drawTape() {
  const el = $('#tape');
  try {
    const deals = (await api('/a2a')).filter((d) => ['approved', 'completed'].includes(d.status)).slice(0, 12);
    if (!deals.length) return mount(el, html`<span class="tape-empty">No deals yet. Start the first one on Home.</span>`);
    const item = (d) => html`<a class="deal" href="#/agent/${d.to?.id}">${d.from ? avatar(d.from.avatar, 22) : ''}<span><b>${d.from?.name}</b> hired <b>${d.to?.name}</b></span><span class="mono">${usd(d.amount)} USDC</span></a>`;
    const track = deals.map(item);
    mount(el, html`<div class="tape-track">${track}${deals.length < 4 ? '' : track}</div>`);
    if (deals.length < 4) $('.tape-track', el).style.animation = 'none';
  } catch { mount(el, raw('')); }
}

async function boot() {
  try { await loadConfig(); } catch (e) { mount(view, html`<div class="empty glass"><div class="ico">${ic('warn')}</div><h3>Server is not reachable</h3><p class="sm">${e.message}</p></div>`); return; }
  drawAccount(); drawTape();
  onSession(() => { drawAccount(); route(); });
  document.addEventListener('tm:refresh-tape', drawTape);
  setInterval(drawTape, 45000);
  window.addEventListener('hashchange', route);
  route();
}
boot();
