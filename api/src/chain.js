// Onchain verification (Base Sepolia). Payments are verified against chain, token, amount,
// recipient, buyer, agent and order id; registrations against the registry event.
const { ethers } = require('ethers');
const cfg = require('./config');
const { conflict, bad } = require('./util');

const regIface = new ethers.Interface([
  'event AgentRegistered(uint256 indexed agentId, address indexed owner, string metadataURI)',
]);
const mktIface = new ethers.Interface([
  'event OrderPaid(bytes32 indexed orderId, uint256 indexed agentId, address indexed buyer, address recipient, address token, uint256 amount)',
]);

let provider;
const getProvider = () => (provider = provider || new ethers.JsonRpcProvider(cfg.rpcUrl, cfg.chainId, { staticNetwork: true }));

async function receiptOrThrow(txHash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || '')) throw bad('Bad transaction hash');
  const rc = await getProvider().getTransactionReceipt(txHash);
  if (!rc) throw conflict('Transaction not confirmed yet, try again in a few seconds');
  if (rc.status !== 1) throw bad('Transaction failed onchain');
  return rc;
}

const orderIdBytes32 = (uuid) => ethers.id(uuid);

async function verifyRegistration(txHash, wallet) {
  const rc = await receiptOrThrow(txHash);
  for (const log of rc.logs) {
    if (log.address.toLowerCase() !== cfg.registry.toLowerCase()) continue;
    try {
      const p = regIface.parseLog(log);
      if (p && p.name === 'AgentRegistered' && p.args.owner.toLowerCase() === wallet.toLowerCase()) return Number(p.args.agentId);
    } catch (_) {}
  }
  throw bad('No matching AgentRegistered event for your wallet in that transaction');
}

async function verifyPayment({ txHash, order, agent, buyer }) {
  const rc = await receiptOrThrow(txHash);
  for (const log of rc.logs) {
    if (log.address.toLowerCase() !== cfg.marketplace.toLowerCase()) continue;
    let p;
    try { p = mktIface.parseLog(log); } catch (_) { continue; }
    if (!p || p.name !== 'OrderPaid') continue;
    const a = p.args;
    if (
      a.orderId === orderIdBytes32(order.id) &&
      Number(a.agentId) === Number(agent.onchain_agent_id) &&
      a.buyer.toLowerCase() === buyer.toLowerCase() &&
      a.token.toLowerCase() === cfg.usdc.toLowerCase() &&
      a.recipient.toLowerCase() === agent.owner_wallet.toLowerCase() &&
      a.amount === BigInt(order.amount)
    ) return true;
  }
  throw bad('Payment does not match this order (chain, token, amount, recipient, buyer or order id)');
}

module.exports = { verifyRegistration, verifyPayment, orderIdBytes32 };
