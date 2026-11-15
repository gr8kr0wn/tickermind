import { createPublicClient, createWalletClient, http, parseEventLogs, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { env, need } from './env.js';
import { bad } from './http.js';
import { agentRegistryAbi, agentVaultAbi, agentMarketplaceAbi } from './abis.js';

export const abis = { registry: agentRegistryAbi, vault: agentVaultAbi, marketplace: agentMarketplaceAbi };
export const USDC_DECIMALS = 6;

const chain = () => (env.chainId === 8453 ? base : baseSepolia);
let pub;
let wallet;

export function publicClient() {
  if (!pub) pub = createPublicClient({ chain: chain(), transport: http(env.rpcUrl) });
  return pub;
}

export function operatorClient() {
  if (!wallet) {
    let key = need('OPERATOR_PRIVATE_KEY');
    if (!key.startsWith('0x')) key = `0x${key}`;
    wallet = createWalletClient({ account: privateKeyToAccount(key), chain: chain(), transport: http(env.rpcUrl) });
  }
  return wallet;
}

export function contractAddress(name) {
  const a = env.addresses[name];
  if (!a) throw new Error(`Missing ${name.toUpperCase()}_ADDRESS in your .env — deploy the contracts first.`);
  return a;
}

/**
 * Fetches a confirmed transaction receipt and returns the decoded events of one contract.
 * Throws a friendly error if the tx failed or did not touch that contract.
 */
export async function eventsFromTx(txHash, contract, eventName) {
  const address = contractAddress(contract);
  const client = publicClient();
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 45_000 });
  } catch {
    throw bad('Transaction not found or not confirmed yet. Wait a few seconds and try again.');
  }
  if (receipt.status !== 'success') throw bad('That transaction failed onchain.');
  const logs = parseEventLogs({ abi: abis[contract], logs: receipt.logs, eventName })
    .filter((l) => l.address.toLowerCase() === address.toLowerCase());
  if (!logs.length) throw bad(`No ${eventName} event from the TickerMind ${contract} in that transaction.`);
  return logs;
}

export const toUsdc = (raw) => Number(formatUnits(BigInt(raw), USDC_DECIMALS));

export async function readVault(onchainId) {
  const address = contractAddress('vault');
  const c = publicClient();
  const id = BigInt(onchainId);
  const call = (functionName) => c.readContract({ address, abi: agentVaultAbi, functionName, args: [id] });
  const [balance, earned, spent, withdrawn, policy] = await Promise.all([
    call('balanceOf'), call('totalEarned'), call('totalSpent'), call('totalWithdrawn'), call('getPolicy'),
  ]);
  return {
    balance: toUsdc(balance),
    earned: toUsdc(earned),
    spent: toUsdc(spent),
    withdrawn: toUsdc(withdrawn),
    policy: { reserve: Number(policy[0]), operating: Number(policy[1]), simulated: Number(policy[2]) },
  };
}

export async function readOrder(onchainOrderId) {
  return publicClient().readContract({
    address: contractAddress('marketplace'),
    abi: agentMarketplaceAbi,
    functionName: 'getOrder',
    args: [BigInt(onchainOrderId)],
  });
}

/** Operator actions: release escrow to the seller's vault, or refund the buyer. */
export async function operatorFulfill(onchainOrderId, reportHash) {
  const w = operatorClient();
  const hash = await w.writeContract({
    address: contractAddress('marketplace'), abi: agentMarketplaceAbi, functionName: 'fulfill',
    args: [BigInt(onchainOrderId), reportHash],
  });
  const r = await publicClient().waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (r.status !== 'success') throw new Error('Fulfill transaction reverted.');
  return hash;
}

export async function operatorRefund(onchainOrderId) {
  const w = operatorClient();
  const hash = await w.writeContract({
    address: contractAddress('marketplace'), abi: agentMarketplaceAbi, functionName: 'refund',
    args: [BigInt(onchainOrderId)],
  });
  await publicClient().waitForTransactionReceipt({ hash, timeout: 60_000 });
  return hash;
}
