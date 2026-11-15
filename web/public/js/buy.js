// Purchase flow: pick ticker + payer (wallet or one of my agents) → approve → pay → agent researches → report.
import { api, session } from './api.js';
import { modal, stepper, esc, icon, toast, identicon, SECTOR_ON, usd } from './ui.js';
import { requireSignIn, write, ensureAllowance, toRaw, usdcBalance, walletError, account, connect } from './wallet.js';

export async function openBuy(service) {
  let s;
  try { s = await requireSignIn(); } catch (e) { return toast(walletError(e), 'error'); }

  let myAgents = [];
  try { myAgents = (await api.get('agents?mine=1')).agents.filter((a) => a.id !== service.agent.id && a.onchainId); } catch { /* none */ }

  const m = modal('Buy research', `
    <div class="stack gap-20">
      <div class="row gap-12" data-sector="${esc(service.agent.sector)}">
        ${identicon(service.agent.name, SECTOR_ON[service.agent.sector], 52)}
        <div class="stack gap-4" style="min-width:0"><b>${esc(service.agent.name)}</b><span class="muted" style="font-size:14px">${esc(service.title)}</span></div>
        <b class="mono" style="margin-left:auto;font-size:20px">${esc(service.price)}<span class="dim" style="font-size:13px"> USDC</span></b>
      </div>
      <div class="field"><label class="label" for="buy-ticker">Ticker</label>
        <input id="buy-ticker" class="input mono" style="text-transform:uppercase;font-size:20px" maxlength="10" value="${esc(service.defaultTicker || '')}" placeholder="NVDA" ${service.defaultTicker ? 'readonly' : ''}></div>
      <div class="field"><span class="label">Pay with</span>
        <div class="stack gap-8" role="radiogroup" id="payers">
          <label class="step" style="cursor:pointer"><input type="radio" name="payer" value="wallet" checked> ${icon('wallet')} <span>My wallet</span><span class="mono muted" style="margin-left:auto;font-size:13px" id="wallet-bal">…</span></label>
          ${myAgents.map((a) => `<label class="step" style="cursor:pointer"><input type="radio" name="payer" value="${esc(a.onchainId)}"> ${icon('cpu')} <span>${esc(a.name)}'s treasury</span><span class="mono muted" style="margin-left:auto;font-size:13px">${a.treasury ? usd(a.treasury.balance) : '—'}</span></label>`).join('')}
        </div>
        ${myAgents.length ? '<span class="muted" style="font-size:13px">Paying from an agent treasury = agent-to-agent purchase.</span>' : ''}
      </div>
      <div id="buy-steps"></div>
      <button class="btn btn-primary btn-lg btn-block" id="buy-go">${icon('bolt')} Pay ${esc(service.price)} USDC</button>
      <p class="muted" style="font-size:12px;text-align:center">Payment sits in escrow until the report is delivered. If the agent fails, you're refunded automatically.</p>
    </div>`);

  const wallet = (await account()) || (await connect());
  usdcBalance(wallet).then((b) => { m.body.querySelector('#wallet-bal').textContent = `${b.toFixed(2)} USDC`; }).catch(() => { m.body.querySelector('#wallet-bal').textContent = ''; });

  m.body.querySelector('#buy-go').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const ticker = m.body.querySelector('#buy-ticker').value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) return toast('Enter a ticker like NVDA.', 'error');
    const payer = m.body.querySelector('input[name=payer]:checked').value;
    const asAgent = payer !== 'wallet';
    const price = toRaw(service.price);

    btn.disabled = true;
    m.lock();
    const labels = asAgent ? ['Pay from agent treasury', 'Agent researches & delivers'] : ['Approve USDC', 'Pay into escrow', 'Agent researches & delivers'];
    const set = stepper(m.body.querySelector('#buy-steps'), labels);
    let i = 0;
    try {
      let tx;
      if (asAgent) {
        set(0, 'active');
        tx = await write('marketplace', 'purchaseAsAgent', [BigInt(service.onchainId), BigInt(payer)]);
        set(0, 'done'); i = 1;
      } else {
        if (s.wallet !== wallet.toLowerCase()) throw new Error('Wallet changed. Sign in again.');
        const bal = await usdcBalance(wallet);
        if (bal < Number(service.price)) throw new Error('Not enough USDC. Get free test USDC at faucet.circle.com (Base Sepolia).');
        set(0, 'active');
        const sent = await ensureAllowance(wallet, price);
        set(0, 'done', sent ? 'USDC approved' : 'USDC already approved'); i = 1;
        set(1, 'active');
        tx = await write('marketplace', 'purchase', [BigInt(service.onchainId)]);
        set(1, 'done'); i = 2;
      }
      set(i, 'active', `${service.agent.name} is researching ${ticker}…`);
      const out = await api.post('orders', { action: 'confirm', txHash: tx.hash, ticker });
      if (out.order.status !== 'fulfilled') throw new Error(out.error || 'The agent could not complete this report.');
      set(i, 'done', 'Report delivered & payment released');
      toast('Report delivered.', 'ok');
      setTimeout(() => { location.href = `/report?id=${out.order.reportId}`; }, 700);
    } catch (e) {
      set(i, 'fail');
      toast(walletError(e), 'error', 8000);
      btn.disabled = false;
      m.lock(false);
    }
  });
}
