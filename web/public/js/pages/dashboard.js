import { mountNav } from '../nav.js';
import { api, session } from '../api.js';
import { $, esc, icon, hydrateIcons, usd, ago, toast } from '../ui.js';
import { agentCard } from '../cards.js';
import { signIn, walletError, hasWallet } from '../wallet.js';

mountNav('dashboard');
hydrateIcons();

const STATUS_TAG = { fulfilled: 'tag-good', pending: 'tag-blue', refunded: 'tag-amber', failed: 'tag-bad' };

function gate() {
  $('#gate').classList.remove('hidden');
  $('#gate').innerHTML = `<div class="empty">${icon('wallet', 32)}<b style="color:var(--paper);font-size:20px">Connect your wallet</b><span>See your agents, treasuries and reports.</span><button class="btn btn-primary btn-lg" id="gate-btn">${icon('wallet')} Connect wallet</button></div>`;
  ['#totals', '#agents'].forEach((s) => { $(s).innerHTML = ''; });
  $('#purchases').closest('section').classList.add('hidden');
  $('#gate-btn').onclick = async () => {
    if (!hasWallet()) return toast('Install Coinbase Wallet or MetaMask first.', 'error');
    try { await signIn(); load(); } catch (e) { toast(walletError(e), 'error'); }
  };
}

async function load() {
  if (!session.get()) return gate();
  $('#gate').classList.add('hidden');
  $('#purchases').closest('section').classList.remove('hidden');
  $('#agents').innerHTML = '<div class="skeleton" style="height:340px"></div><div class="skeleton" style="height:340px"></div>';
  try {
    const [{ agents }, { orders }] = await Promise.all([api.get('agents?mine=1'), api.get('orders?mine=1')]);
    const sum = (f) => agents.reduce((s, a) => s + (f(a) || 0), 0);
    $('#totals').innerHTML = [
      ['Agents', agents.length, ''],
      ['Treasury', usd(sum((a) => a.treasury?.balance)), ''],
      ['Earned', usd(sum((a) => a.treasury?.earned)), ''],
      ['Reports sold', sum((a) => a.stats?.completed), ''],
    ].map(([l, v]) => `<div class="kpi"><span>${l}</span><b>${esc(v)}</b></div>`).join('');

    $('#agents').innerHTML = agents.map(agentCard).join('') + `<a href="/create" class="empty" style="min-height:320px;color:var(--paper)">${icon('plus', 32)}<b>New agent</b><span class="muted">Takes about a minute</span></a>`;

    $('#purchases').innerHTML = orders.length
      ? `<div class="table-box"><table><thead><tr><th>Report</th><th>Agent</th><th>Paid</th><th>Status</th><th>When</th></tr></thead><tbody>${orders.map((o) => `
        <tr><td>${o.reportId ? `<a href="/report?id=${esc(o.reportId)}" class="row gap-8">${icon('file', 14)}<b class="mono">${esc(o.ticker)}</b></a>` : `<b class="mono">${esc(o.ticker)}</b>`}</td>
        <td>${o.seller ? `<a href="/agent?id=${esc(o.seller.id)}">${esc(o.seller.name)}</a>` : ''}${o.buyerAgent ? ` <span class="tag">via ${esc(o.buyerAgent.name)}</span>` : ''}</td>
        <td class="mono">${o.amount} USDC</td><td><span class="tag ${STATUS_TAG[o.status] || ''}">${esc(o.status)}</span></td><td class="muted">${ago(o.createdAt)}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${icon('store', 28)}<span>No purchases yet.</span><a href="/marketplace" class="btn btn-glass">Browse the marketplace</a></div>`;
  } catch (e) {
    if (e.status === 401) return gate();
    toast(e.message, 'error');
  }
}

window.addEventListener('tm:session', load);
load();
