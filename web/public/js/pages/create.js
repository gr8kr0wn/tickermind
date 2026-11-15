import { mountNav } from '../nav.js';
import { api } from '../api.js';
import { $, $$, esc, icon, identicon, hydrateIcons, splitBar, modal, stepper, toast, SECTOR_LABEL, SECTOR_ICON, SECTOR_ON, STRATEGY_LABEL, FREQ_LABEL } from '../ui.js';
import { requireSignIn, write, walletError, hasWallet } from '../wallet.js';

mountNav('create');
hydrateIcons();

const POLICIES = [
  { id: 'safe', label: 'Safe', reserve: 6000, operating: 2000, simulated: 2000 },
  { id: 'balanced', label: 'Balanced', reserve: 4000, operating: 2000, simulated: 4000 },
  { id: 'bold', label: 'Bold', reserve: 2000, operating: 2000, simulated: 6000 },
];
const state = { sector: 'technology', strategy: 'long_term', frequency: 'on_demand', policy: 'balanced' };

// ─── controls
$('#sectors').innerHTML = Object.entries(SECTOR_LABEL).map(([id, l]) => `<button type="button" class="chip" data-sector="${id}" aria-pressed="${id === state.sector}">${icon(SECTOR_ICON[id], 16, 1.8)}${l}</button>`).join('');
$('#strategy').innerHTML = Object.entries(STRATEGY_LABEL).map(([id, l]) => `<button type="button" data-v="${id}" aria-pressed="${id === state.strategy}">${l}</button>`).join('');
$('#freq').innerHTML = Object.entries(FREQ_LABEL).map(([id, l]) => `<button type="button" data-v="${id}" aria-pressed="${id === state.frequency}">${l}</button>`).join('');
$('#policies').innerHTML = POLICIES.map((p) => `<button type="button" class="pol" data-p="${p.id}" aria-pressed="${p.id === state.policy}"><b>${p.label}</b>${splitBar(p.reserve, p.operating, p.simulated, 10)}<span class="mono muted" style="font-size:12px">${p.reserve / 100}/${p.operating / 100}/${p.simulated / 100}</span></button>`).join('');
$('#perms').innerHTML = [
  ['Read market data', 'ON', 'tag-blue', 'check'], ['Generate research', 'ON', 'tag-blue', 'check'], ['Receive USDC', 'ON', 'tag-blue', 'check'],
  ['Recommend splits', 'ON', 'tag-blue', 'check'], ['Execute trades', 'LOCKED', '', 'lock'],
].map(([l, s, c, ic]) => `<div class="perm"><span>${l}</span><span class="tag ${c}">${icon(ic, 12)}${s}</span></div>`).join('');

const pick = (group, attr, key) => group.addEventListener('click', (e) => {
  const b = e.target.closest(`[${attr}]`);
  if (!b) return;
  state[key] = b.getAttribute(attr);
  $$(`[${attr}]`, group).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  render();
});
pick($('#sectors'), 'data-sector', 'sector');
pick($('#strategy'), 'data-v', 'strategy');
pick($('#freq'), 'data-v', 'frequency');
pick($('#policies'), 'data-p', 'policy');
['#name', '#price', '#svc-ticker', '#budget', '#sell', '#tickers'].forEach((s) => $(s).addEventListener('input', render));

// ─── live preview
function render() {
  const name = $('#name').value.trim().toUpperCase();
  const p = POLICIES.find((x) => x.id === state.policy);
  const sell = $('#sell').checked;
  $('#card').dataset.sector = state.sector;
  $('#card-top').dataset.sector = state.sector;
  $('#card-ident').innerHTML = identicon(name || 'YOUR AGENT', SECTOR_ON[state.sector], 136);
  $('#card-name').textContent = name || 'YOUR AGENT';
  $('#card-sector').textContent = SECTOR_LABEL[state.sector];
  $('#card-strat').textContent = STRATEGY_LABEL[state.strategy];
  $('#card-freq').textContent = FREQ_LABEL[state.frequency];
  $('#card-pol').textContent = `${p.reserve / 100} / ${p.operating / 100} / ${p.simulated / 100}`;
  $('#card-bar').innerHTML = splitBar(p.reserve, p.operating, p.simulated, 12);
  $('#card-sell').textContent = sell ? `Sells ${($('#svc-ticker').value.trim().toUpperCase() || 'any ticker')} reports` : 'Not selling yet';
  $('#card-price').textContent = sell ? `${Number($('#price').value || 0)} USDC` : '';
  $('#sell-fields').classList.toggle('hidden', !sell);
  $('#budget-val').textContent = `${$('#budget').value} USDC`;
  const done = [name.length >= 2, true, true, sell ? Number($('#price').value) > 0 : true].filter(Boolean).length;
  $$('.progress i').forEach((el, i) => el.classList.toggle('on', i < done));
  $('#prog').textContent = `${done}/4`;
  const prompts = 1 + (state.policy !== 'balanced' ? 1 : 0) + (sell ? 1 : 0);
  $('#gas-note').textContent = `TESTNET · ${prompts} WALLET PROMPT${prompts > 1 ? 'S' : ''} + SIGN-IN`;
}
render();

// ─── deploy flow
let draft = null; // survives retries in the same session

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#name').value.trim().toUpperCase();
  if (name.length < 2) { $('#name').focus(); return toast('Give your agent a name.', 'error'); }
  if (!hasWallet()) return toast('Install Coinbase Wallet or MetaMask to deploy.', 'error', 6000);
  const sell = $('#sell').checked;
  const price = Number($('#price').value);
  if (sell && !(price >= 0.01)) return toast('Set a price of at least 0.01 USDC.', 'error');
  const p = POLICIES.find((x) => x.id === state.policy);

  const labels = ['Sign in with wallet', 'Register agent onchain'];
  if (state.policy !== 'balanced') labels.push('Save treasury policy onchain');
  if (sell) labels.push('List report service');
  const m = modal('Deploying your agent', `<div class="stack gap-16"><div class="row gap-12" data-sector="${state.sector}">${identicon(name, SECTOR_ON[state.sector], 48)}<b style="font-size:20px">${esc(name)}</b></div><div id="dep-steps"></div><button class="btn btn-primary btn-block hidden" id="dep-retry">${icon('refresh')} Try again</button></div>`);
  m.lock();
  const set = stepper(m.body.querySelector('#dep-steps'), labels);
  let i = 0;
  try {
    set(i, 'active');
    await requireSignIn();
    set(i++, 'done');

    set(i, 'active');
    if (!draft || draft.name !== name) {
      const d = await api.post('agents', {
        action: 'create', name, description: $('#desc').value.trim(), sector: state.sector, strategy: state.strategy,
        frequency: state.frequency, focusTickers: $('#tickers').value, policy: { reserve: p.reserve, operating: p.operating, simulated: p.simulated },
        operatingBudget: Number($('#budget').value), publishMode: $('#autopub').checked ? 'auto' : 'approval',
      });
      draft = { ...d, name };
    }
    if (!draft.onchainId) {
      if (!draft.registerTx) draft.registerTx = (await write('registry', 'register', [draft.metadataURI])).hash;
      const c = await api.post('agents', { action: 'confirm', id: draft.id, txHash: draft.registerTx });
      draft.onchainId = c.onchainId;
    }
    set(i++, 'done', `Registered as agent #${String(draft.onchainId).padStart(4, '0')}`);

    if (state.policy !== 'balanced') {
      set(i, 'active');
      if (!draft.policySet) {
        if (!draft.policyTx) draft.policyTx = (await write('vault', 'setPolicy', [BigInt(draft.onchainId), p.reserve, p.operating, p.simulated])).hash;
        await api.post('agents', { action: 'policy', id: draft.id, txHash: draft.policyTx });
        draft.policySet = true;
      }
      set(i++, 'done');
    }

    if (sell) {
      set(i, 'active');
      if (!draft.serviceDone) {
        const tk = $('#svc-ticker').value.trim().toUpperCase();
        const svc = draft.svc || (draft.svc = await api.post('services', {
          action: 'create', agentId: draft.id, price,
          title: tk ? `${tk} company research report` : `${SECTOR_LABEL[state.sector]} company research report`,
          description: `${STRATEGY_LABEL[state.strategy]} analysis with sourced facts and an AI conclusion.`, defaultTicker: tk || undefined,
        }));
        if (!draft.svcTx) draft.svcTx = (await write('marketplace', 'createService', [BigInt(svc.agentOnchainId), BigInt(svc.priceRaw), svc.metadataURI])).hash;
        await api.post('services', { action: 'confirm', id: svc.id, txHash: draft.svcTx });
        draft.serviceDone = true;
      }
      set(i++, 'done');
    }

    toast(`${name} is live on Base.`, 'ok');
    setTimeout(() => { location.href = `/agent?id=${draft.id}`; }, 800);
  } catch (err) {
    set(i, 'fail');
    toast(walletError(err), 'error', 8000);
    m.lock(false);
    const retry = m.body.querySelector('#dep-retry');
    retry.classList.remove('hidden');
    retry.onclick = () => { m.close(); $('#form').requestSubmit(); };
  }
});
