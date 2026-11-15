// One-time deployer: deploys AgentRegistry, AgentVault and AgentMarketplace from the connected wallet.
import { mountNav } from '../nav.js';
import { $, $$, icon, hydrateIcons, stepper, toast, esc } from '../ui.js';
import { walletError } from '../wallet.js';
import { createWalletClient, createPublicClient, custom, http, baseSepolia, generatePrivateKey, privateKeyToAccount, parseEther } from '../vendor/viem.js';
import { AgentRegistry, AgentVault, AgentMarketplace } from '../bytecode.js';

mountNav('');
hydrateIcons();
$('#core').innerHTML = icon('bolt', 34, 2);

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'; // Circle USDC on Base Sepolia
const RPC = 'https://sepolia.base.org';
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');

$$('input[name=op]').forEach((r) => r.addEventListener('change', () => {
  const paste = $('input[name=op]:checked').value === 'paste';
  $('#op-addr').disabled = !paste;
  if (paste) $('#op-addr').focus();
}));

$('#go').addEventListener('click', async () => {
  if (!window.ethereum) return toast('Open this page in Coinbase Wallet or MetaMask browser.', 'error', 7000);
  const mode = $('input[name=op]:checked').value;
  let opKey = null;
  let operator;
  if (mode === 'paste') {
    operator = $('#op-addr').value.trim();
    if (!isAddr(operator)) return toast('Paste a valid operator address.', 'error');
  } else {
    opKey = generatePrivateKey();
    operator = privateKeyToAccount(opKey).address;
  }
  const fund = $('#fund').checked;

  const btn = $('#go');
  btn.disabled = true;
  const labels = ['Connect wallet on Base Sepolia', 'Deploy AgentRegistry', 'Deploy AgentVault', 'Deploy AgentMarketplace', 'Link vault → marketplace'];
  if (fund) labels.push('Fund operator with 0.005 ETH');
  const set = stepper($('#steps'), labels);
  const out = {};
  let i = 0;
  try {
    set(i, 'active');
    const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
    const w = createWalletClient({ chain: baseSepolia, transport: custom(window.ethereum) });
    const [account] = await w.requestAddresses();
    const hex = `0x${baseSepolia.id.toString(16)}`;
    if ((await window.ethereum.request({ method: 'eth_chainId' })) !== hex) {
      try { await w.switchChain({ id: baseSepolia.id }); } catch { await w.addChain({ chain: baseSepolia }); }
    }
    const bal = await pub.getBalance({ address: account });
    if (bal < parseEther(fund ? '0.007' : '0.002')) throw new Error(`Your wallet needs Base Sepolia ETH (have ${Number(bal) / 1e18}). Use a Base Sepolia faucet, then retry.`);
    set(i++, 'done', `Connected ${account.slice(0, 6)}…${account.slice(-4)}`);

    const deploy = async (c, args) => {
      const hash = await w.deployContract({ account, abi: c.abi, bytecode: c.bytecode, args });
      const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (r.status !== 'success' || !r.contractAddress) throw new Error('Deployment failed onchain.');
      return r.contractAddress;
    };
    const send = async (hashP) => {
      const r = await pub.waitForTransactionReceipt({ hash: await hashP, timeout: 120_000 });
      if (r.status !== 'success') throw new Error('Transaction failed onchain.');
    };

    set(i, 'active'); out.registry = await deploy(AgentRegistry, []); set(i++, 'done');
    set(i, 'active'); out.vault = await deploy(AgentVault, [USDC, out.registry]); set(i++, 'done');
    set(i, 'active'); out.marketplace = await deploy(AgentMarketplace, [USDC, out.registry, out.vault, operator]); set(i++, 'done');
    set(i, 'active');
    await send(w.writeContract({ account, address: out.vault, abi: AgentVault.abi, functionName: 'setMarketplace', args: [out.marketplace] }));
    set(i++, 'done');
    if (fund) {
      set(i, 'active');
      await send(w.sendTransaction({ account, to: operator, value: parseEther('0.005') }));
      set(i++, 'done');
    }

    const env = [
      `REGISTRY_ADDRESS=${out.registry}`,
      `VAULT_ADDRESS=${out.vault}`,
      `MARKETPLACE_ADDRESS=${out.marketplace}`,
      `USDC_ADDRESS=${USDC}`,
      opKey ? `OPERATOR_PRIVATE_KEY=${opKey}` : `# OPERATOR_PRIVATE_KEY= (private key of ${operator})`,
    ].join('\n');
    const r = $('#result');
    r.classList.remove('hidden');
    r.innerHTML = `
      <div class="row gap-8 good">${icon('check', 20, 3)}<b style="font-size:20px;color:var(--paper)">Deployed</b></div>
      ${opKey ? `<div class="warn">${icon('alert', 18)}<span>Copy this now. The operator key is shown only once and is not saved anywhere. Testnet only — never reuse it on mainnet.</span></div>` : ''}
      <div class="envbox" id="env">${esc(env)}</div>
      <button class="btn btn-paper btn-lg btn-block" id="copy">${icon('copy')} Copy for .env</button>
      <a class="row gap-8 mono" style="font-size:13px" target="_blank" rel="noopener" href="https://sepolia.basescan.org/address/${esc(out.marketplace)}">View marketplace on BaseScan ${icon('ext', 12)}</a>
      <p class="muted" style="font-size:14px">Paste into <span class="mono">web/.env</span> (and Vercel env vars), then restart. You can delete <span class="mono">deploy.html</span> afterwards.</p>`;
    $('#copy').onclick = async () => {
      try { await navigator.clipboard.writeText(env); toast('Copied.', 'ok'); }
      catch { const sel = getSelection(); const rg = document.createRange(); rg.selectNodeContents($('#env')); sel.removeAllRanges(); sel.addRange(rg); toast('Selected — copy it manually.'); }
    };
    window.addEventListener('beforeunload', (e) => { if (opKey) { e.preventDefault(); e.returnValue = ''; } });
    btn.classList.add('hidden');
  } catch (e) {
    set(i, 'fail');
    toast(walletError(e), 'error', 9000);
    if (Object.keys(out).length) toast(`Partial deploy: ${Object.entries(out).map(([k, v]) => `${k} ${v}`).join(', ')}`, 'info', 15000);
    btn.disabled = false;
  }
});
