// API client + wallet session + onchain helpers (Base Sepolia).
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
export const state = { token: ls.get('tm_token'), wallet: ls.get('tm_wallet'), config: null };
const listeners = new Set();
export const onSession = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((f) => f());

// Backend URL. Edit this one line after you deploy (or set window.TICKERMIND_API before app.js loads).
export const API_BASE = (typeof window !== 'undefined' && window.TICKERMIND_API) || 'https://irxucxdkwpmsbrqehszx.supabase.co/functions/v1/tickermind-api/api';

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API_BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { signOut(); }
  if (!res.ok) throw new Error(j.error || 'Something went wrong. Try again.');
  return j;
}

export async function loadConfig() { state.config = await api('/config'); return state.config; }
export const isSignedIn = () => !!state.token;

const hexChain = () => '0x' + state.config.chainId.toString(16);
async function ensureChain() {
  try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChain() }] }); }
  catch (e) {
    if (e.code === 4902 || /unrecognized|not added/i.test(e.message || '')) {
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hexChain(), chainName: 'Base Sepolia', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [state.config.rpcUrl], blockExplorerUrls: [state.config.explorer] }] });
    } else throw e;
  }
}
const getSigner = async () => {
  if (!window.ethereum || !window.ethers) throw new Error('No wallet found. Install MetaMask or Coinbase Wallet, then reload.');
  const provider = new window.ethers.BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  await ensureChain();
  return new window.ethers.BrowserProvider(window.ethereum).getSigner();
};

export async function connect() {
  const signer = await getSigner();
  const address = await signer.getAddress();
  const { nonce, message } = await api('/auth/nonce');
  const signature = await signer.signMessage(message);
  const r = await api('/auth/verify', { method: 'POST', body: { address, signature, nonce } });
  state.token = r.token; state.wallet = r.address;
  ls.set('tm_token', r.token); ls.set('tm_wallet', r.address);
  emit();
  return r.address;
}
export function signOut() { state.token = null; state.wallet = null; ls.del('tm_token'); ls.del('tm_wallet'); emit(); }
if (typeof window !== 'undefined') window.addEventListener('load', () => { window.ethereum?.on?.('accountsChanged', () => { if (state.token) signOut(); }); });

// ---- onchain actions ----
const REGISTRY_ABI = ['function registerAgent(string metadataURI) returns (uint256)'];
const USDC_ABI = ['function approve(address spender,uint256 amount) returns (bool)', 'function allowance(address owner,address spender) view returns (uint256)', 'function balanceOf(address) view returns (uint256)'];
const MARKET_ABI = ['function payForOrder(bytes32 orderId,uint256 agentId,uint256 amount)'];

export async function registerAgentOnchain(meta) {
  const signer = await getSigner();
  const uri = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(meta));
  const c = new window.ethers.Contract(state.config.registry, REGISTRY_ABI, signer);
  const tx = await c.registerAgent(uri);
  await tx.wait();
  return tx.hash;
}
export async function payOrderOnchain(p, onStep = () => {}) {
  const signer = await getSigner();
  const me = await signer.getAddress();
  const usdc = new window.ethers.Contract(p.usdc, USDC_ABI, signer);
  const amount = BigInt(p.amount);
  if ((await usdc.balanceOf(me)) < amount) throw new Error('Not enough testnet USDC. Get some free at faucet.circle.com (pick Base Sepolia).');
  if ((await usdc.allowance(me, p.marketplace)) < amount) { onStep('approve'); await (await usdc.approve(p.marketplace, amount)).wait(); }
  onStep('pay');
  const tx = await new window.ethers.Contract(p.marketplace, MARKET_ABI, signer).payForOrder(p.orderIdBytes32, p.agentOnchainId, amount);
  await tx.wait();
  return tx.hash;
}
export const friendlyErr = (e) => (e?.code === 'ACTION_REJECTED' || e?.code === 4001 ? 'You cancelled the wallet request.' : e?.shortMessage || e?.message || 'Something went wrong.');
