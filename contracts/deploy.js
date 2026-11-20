// Deploys AgentRegistry + Marketplace to Base Sepolia (or any RPC) with plain Node.
//   DEPLOYER_PRIVATE_KEY=0x... node contracts/deploy.js
// Get Base Sepolia ETH from a faucet first. Uses Circle's official testnet USDC by default.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { compile } = require('./compile');

const RPC = process.env.BASE_RPC_URL || 'https://sepolia.base.org';
const USDC = process.env.USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

(async () => {
  if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error('Set DEPLOYER_PRIVATE_KEY in .env');
  const art = compile();
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  const net = await provider.getNetwork();
  if (net.chainId !== 84532n && !process.env.ALLOW_OTHER_CHAIN) {
    throw new Error(`Expected Base Sepolia (84532), got ${net.chainId}. Set ALLOW_OTHER_CHAIN=1 to override.`);
  }
  console.log('Deployer:', wallet.address);

  const deploy = async (name, ...args) => {
    const f = new ethers.ContractFactory(art[name].abi, art[name].bytecode, wallet);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    const addr = await c.getAddress();
    console.log(`${name}: ${addr}`);
    return addr;
  };

  const registry = await deploy('AgentRegistry');
  const marketplace = await deploy('Marketplace', USDC, registry);

  const out = {
    chainId: Number(net.chainId),
    network: 'base-sepolia',
    usdc: USDC,
    agentRegistry: registry,
    marketplace,
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(__dirname, 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'baseSepolia.json'), JSON.stringify(out, null, 2));
  console.log('\nSaved contracts/deployments/baseSepolia.json');
  console.log('Add to .env:\n  AGENT_REGISTRY_ADDRESS=' + registry + '\n  MARKETPLACE_ADDRESS=' + marketplace);
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
