// Local contract tests: compiles with solc-js, runs against an in-process ganache chain.
const assert = require('assert');
const ganache = require('ganache');
const { ethers } = require('ethers');
const { compile } = require('../compile');

async function expectRevert(promise, label) {
  try {
    const tx = await promise;
    // some reverts only surface at mining time, so wait for the receipt too
    if (tx && typeof tx.wait === 'function') await tx.wait();
  } catch (e) {
    return;
  }
  throw new Error('Expected revert: ' + label);
}

(async () => {
  const art = compile();
  const provider = new ethers.BrowserProvider(
    ganache.provider({ logging: { quiet: true }, wallet: { totalAccounts: 4, defaultBalance: 1000 } })
  );
  const [owner, agentOwner, buyer, stranger] = await Promise.all([0, 1, 2, 3].map((i) => provider.getSigner(i)));

  const deploy = async (name, signer, ...args) => {
    const f = new ethers.ContractFactory(art[name].abi, art[name].bytecode, signer);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    return c;
  };

  const usdc = await deploy('MockUSDC', owner);
  const registry = await deploy('AgentRegistry', owner);
  const market = await deploy('Marketplace', owner, await usdc.getAddress(), await registry.getAddress());

  let passed = 0;
  const t = async (name, fn) => {
    await fn();
    passed++;
    console.log('  ok -', name);
  };

  await t('registers an agent and assigns id 1', async () => {
    await (await registry.connect(agentOwner).registerAgent('ipfs://meta1')).wait();
    assert.equal(await registry.ownerOf(1), await agentOwner.getAddress());
    assert.equal(await registry.isActive(1), true);
  });

  await t('rejects empty metadata', async () => {
    await expectRevert(registry.connect(agentOwner).registerAgent(''), 'empty metadata');
  });

  await t('only owner can update/deactivate', async () => {
    await expectRevert(registry.connect(stranger).updateMetadata(1, 'x'), 'non-owner update');
    await expectRevert(registry.connect(stranger).deactivateAgent(1), 'non-owner deactivate');
  });

  await t('allocation policy must total 10000 bps', async () => {
    await expectRevert(registry.connect(agentOwner).setAllocationPolicy(1, 5000, 5000, 1), 'sum != 10000');
    await (await registry.connect(agentOwner).setAllocationPolicy(1, 4000, 4000, 2000)).wait();
  });

  await t('integer allocation split has no dust (500 USDC -> 200/200/100)', async () => {
    const amt = 500_000_000n;
    const [r, s, o] = await registry.calculateAllocation(1, amt);
    assert.equal(r, 200_000_000n);
    assert.equal(s, 200_000_000n);
    assert.equal(o, 100_000_000n);
    const [r2, s2, o2] = await registry.calculateAllocation(1, 1_000_001n);
    assert.equal(r2 + s2 + o2, 1_000_001n);
  });

  const orderId = ethers.id('order-1');
  await (await usdc.mint(await buyer.getAddress(), 100_000_000n)).wait();

  await t('payForOrder moves USDC buyer -> agent owner and emits OrderPaid', async () => {
    await (await usdc.connect(buyer).approve(await market.getAddress(), 5_000_000n)).wait();
    const tx = await market.connect(buyer).payForOrder(orderId, 1, 5_000_000n);
    const rc = await tx.wait();
    const log = rc.logs.map((l) => { try { return market.interface.parseLog(l); } catch { return null; } }).find((l) => l && l.name === 'OrderPaid');
    assert.ok(log, 'OrderPaid emitted');
    assert.equal(log.args.orderId, orderId);
    assert.equal(log.args.amount, 5_000_000n);
    assert.equal(log.args.recipient, await agentOwner.getAddress());
    assert.equal(await usdc.balanceOf(await agentOwner.getAddress()), 5_000_000n);
    assert.equal(await market.revenueOf(1), 5_000_000n);
  });

  await t('same orderId cannot be paid twice', async () => {
    await (await usdc.connect(buyer).approve(await market.getAddress(), 5_000_000n)).wait();
    await expectRevert(market.connect(buyer).payForOrder(orderId, 1, 5_000_000n), 'double pay');
  });

  await t('zero amount and missing allowance revert', async () => {
    await expectRevert(market.connect(buyer).payForOrder(ethers.id('o2'), 1, 0), 'zero');
    await expectRevert(market.connect(buyer).payForOrder(ethers.id('o3'), 1, 50_000_000n), 'no allowance');
  });

  await t('only agent owner can mark delivered, once', async () => {
    const h = ethers.id('report-1');
    await expectRevert(market.connect(stranger).markDelivered(orderId, h), 'stranger deliver');
    await (await market.connect(agentOwner).markDelivered(orderId, h)).wait();
    await expectRevert(market.connect(agentOwner).markDelivered(orderId, h), 'double deliver');
    await expectRevert(market.connect(agentOwner).markDelivered(ethers.id('nope'), h), 'unknown order');
  });

  await t('deactivated agents cannot receive orders', async () => {
    await (await registry.connect(agentOwner).deactivateAgent(1)).wait();
    await (await usdc.connect(buyer).approve(await market.getAddress(), 5_000_000n)).wait();
    await expectRevert(market.connect(buyer).payForOrder(ethers.id('o4'), 1, 5_000_000n), 'inactive');
  });

  console.log(`\n${passed} contract tests passed`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
