// Wallet connection + transactions on Base, using viem straight from a CDN (no build step).
// viem is pre-bundled into /js/vendor/viem.js (see scripts/bundle-viem.sh), so there's no build step and no CDN dependency.
import { createWalletClient, createPublicClient, custom, http, parseUnits, formatUnits, maxUint256, base, baseSepolia } from './vendor/viem.js';
import { api, session, getConfig } from './api.js';
import { agentRegistryAbi, agentVaultAbi, agentMarketplaceAbi, erc20Abi } from './abis.js';

export const ABI = { registry: agentRegistryAbi, vault: agentVaultAbi, marketplace: agentMarketplaceAbi, usdc: erc20Abi };
export { parseUnits, formatUnits };

let cfg;
let chain;
let pub;

async function setup() {
  if (!cfg) {
    cfg = await getConfig();
    chain = cfg.chainId === 8453 ? base : baseSepolia;
    pub = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  }
  return { cfg, chain, pub };
}

export const hasWallet = () => typeof window !== 'undefined' && Boolean(window.ethereum);

function provider() {
  if (!window.ethereum) throw new Error('No wallet found. Install Coinbase Wallet or MetaMask, then refresh.');
  return window.ethereum;
}

async function walletClient() {
  await setup();
  return createWalletClient({ chain, transport: custom(provider()) });
}

export async function connect() {
  const w = await walletClient();
  const [address] = await w.requestAddresses();
  return address;
}

export async function ensureChain() {
  await setup();
  const p = provider();
  const hex = `0x${chain.id.toString(16)}`;
  const current = await p.request({ method: 'eth_chainId' });
  if (current === hex) return;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e) {
    if (e.code === 4902 || /unrecognized|not added/i.test(e.message)) {
      await p.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: hex, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [cfg.rpcUrl], blockExplorerUrls: [cfg.explorer] }],
      });
    } else throw e;
  }
}

// Must match lib/auth.js signInMessage on the server exactly.
const signInMessage = (address, issuedAt, chainId) =>
  `TickerMind wants you to sign in.\n\nWallet: ${address.toLowerCase()}\nChain: ${chainId}\nIssued: ${issuedAt}\n\nThis does not send a transaction or cost gas.`;

/** Connect + sign a message → session token. Returns { wallet, agentCount }. */
export async function signIn() {
  const { cfg: c } = await setup();
  const address = await connect();
  const issuedAt = new Date().toISOString();
  const w = await walletClient();
  const signature = await w.signMessage({ account: address, message: signInMessage(address, issuedAt, c.chainId) });
  const out = await api.post('auth', { address, issuedAt, signature });
  session.set({ token: out.token, wallet: out.wallet });
  return out;
}

export function signOut() { session.clear(); }

/** Make sure we have a session; prompts sign-in if not. */
export async function requireSignIn() {
  const s = session.get();
  if (s?.token) return s;
  await signIn();
  return session.get();
}

export async function account() {
  const accounts = await provider().request({ method: 'eth_accounts' });
  return accounts[0];
}

/** Sends a contract write from the connected wallet and waits for it to confirm. Returns { hash, receipt }. */
export async function write(contract, functionName, args) {
  const { cfg: c, pub: p } = await setup();
  if (!c.contractsReady) throw new Error('Contracts are not deployed yet. Add the addresses to your .env.');
  await ensureChain();
  const w = await walletClient();
  const from = await account() || (await connect());
  const address = contract === 'usdc' ? c.addresses.usdc : c.addresses[contract];
  const hash = await w.writeContract({ account: from, address, abi: ABI[contract], functionName, args, chain });
  const receipt = await p.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== 'success') throw new Error('Transaction failed onchain.');
  return { hash, receipt };
}

export async function read(contract, functionName, args = []) {
  const { cfg: c, pub: p } = await setup();
  const address = contract === 'usdc' ? c.addresses.usdc : c.addresses[contract];
  return p.readContract({ address, abi: ABI[contract], functionName, args });
}

export const toRaw = (amount) => parseUnits(String(amount), 6);
export const fromRaw = (raw) => Number(formatUnits(BigInt(raw), 6));

export async function usdcBalance(addr) { return fromRaw(await read('usdc', 'balanceOf', [addr])); }

/** Approve the marketplace to spend USDC if the allowance is too low. Returns true if a tx was sent. */
export async function ensureAllowance(owner, amountRaw) {
  const { cfg: c } = await setup();
  const allowance = await read('usdc', 'allowance', [owner, c.addresses.marketplace]);
  if (allowance >= amountRaw) return false;
  await write('usdc', 'approve', [c.addresses.marketplace, maxUint256]);
  return true;
}

export async function explorerTx(hash) { const { cfg: c } = await setup(); return `${c.explorer}/tx/${hash}`; }
export async function explorerAddress(a) { const { cfg: c } = await setup(); return `${c.explorer}/address/${a}`; }

/** Human-friendly wallet errors. */
export function walletError(e) {
  const m = e?.shortMessage || e?.message || String(e);
  if (/user rejected|denied|rejected the request/i.test(m)) return 'You cancelled in your wallet.';
  if (/insufficient funds/i.test(m)) return 'Not enough Base Sepolia ETH for gas. Grab some from a faucet.';
  if (/exceeds balance|transfer amount|balance/i.test(m) && /usdc|erc20|balance/i.test(m)) return 'Not enough USDC. Get test USDC at faucet.circle.com.';
  return m.split('\n')[0].slice(0, 180);
}

// Sign out if the wallet switches accounts.
if (hasWallet()) {
  window.ethereum.on?.('accountsChanged', (accs) => {
    const s = session.get();
    if (s && (!accs[0] || accs[0].toLowerCase() !== s.wallet)) session.clear();
  });
}
