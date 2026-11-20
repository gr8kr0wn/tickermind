// Onchain integration: real contracts on a local chain (chainId 84532), real ethers txs, real API verification.
const os = require('os');
const path = require('path');
const assert = require('assert');
const ganache = require('ganache');
const { ethers } = require('ethers');
const { compile } = require('../../contracts/compile');

const PORT = 8599;
const owner = ethers.Wallet.createRandom(), buyer = ethers.Wallet.createRandom(), mallory = ethers.Wallet.createRandom();
const dep = ethers.Wallet.createRandom();

(async () => {
  const srv = ganache.server({ logging: { quiet: true }, chain: { chainId: 84532 }, wallet: { accounts: [dep, owner, buyer, mallory].map((w) => ({ secretKey: w.privateKey, balance: '0x56BC75E2D63100000' })) } });
  await srv.listen(PORT);
  const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${PORT}`, 84532, { staticNetwork: true, cacheTimeout: -1 });
  const art = compile();
  const deploy = async (n, signer, ...a) => { const c = await new ethers.ContractFactory(art[n].abi, art[n].bytecode, signer).deploy(...a); await c.waitForDeployment(); return c; };
  const D = dep.connect(provider), O = owner.connect(provider), B = buyer.connect(provider), M = mallory.connect(provider);
  const usdc = await deploy('MockUSDC', D), reg = await deploy('AgentRegistry', D);
  const mkt = await deploy('Marketplace', D, await usdc.getAddress(), await reg.getAddress());

  process.env.LOCAL_DB_FILE = path.join(os.tmpdir(), 'tm-chain-' + Date.now() + '.json');
  Object.assign(process.env, { BASE_RPC_URL: `http://127.0.0.1:${PORT}`, CHAIN_ID: '84532', USDC_ADDRESS: await usdc.getAddress(), AGENT_REGISTRY_ADDRESS: await reg.getAddress(), MARKETPLACE_ADDRESS: await mkt.getAddress(), DEMO_MODE: '0', SESSION_SECRET: 's', SCHEDULER_ENABLED: '0' });
  delete process.env.SUPABASE_URL;
  const { createApp } = require('../src/server');
  const worker = require('../src/worker');
  const app = createApp().listen(0);
  const base = `http://127.0.0.1:${app.address().port}`;
  const api = async (m, u, token, body) => { const r = await fetch(base + '/api' + u, { method: m, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  const login = async (w) => { const n = (await api('GET', '/auth/nonce')).body; return (await api('POST', '/auth/verify', null, { address: w.address, signature: await w.signMessage(n.message), nonce: n.nonce })).body.token; };
  const [to, tb, tm] = await Promise.all([login(owner), login(buyer), login(mallory)]);

  let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ok -', name); };
  let agent, svc, order;

  await t('production mode: creating an agent without an onchain registration is refused', async () => {
    const r = await api('POST', '/agents', to, { name: 'NoChain', specialization: 'technology' });
    assert.equal(r.status, 400); assert.match(r.body.error, /onchain/i);
  });

  let regTx;
  await t('registers onchain; API verifies the AgentRegistered event and links the onchain id', async () => {
    const tx = await reg.connect(O).registerAgent('data:application/json,{}'); await tx.wait(); regTx = tx.hash;
    const r = await api('POST', '/agents', to, { name: 'CHAIN AGENT', description: 'x', specialization: 'technology', researchTargets: ['NVDA'], registerTx: regTx });
    assert.equal(r.status, 201); assert.equal(r.body.onchainAgentId, 1); agent = r.body;
  });
  await t("someone else cannot claim another wallet's registration tx", async () => {
    const r = await api('POST', '/agents', tm, { name: 'Stolen', specialization: 'technology', registerTx: regTx });
    assert.equal(r.status, 400);
  });
  await t('the same registration cannot be linked twice', async () => {
    const r = await api('POST', '/agents', to, { name: 'Dupe', specialization: 'technology', registerTx: regTx });
    assert.equal(r.status, 409);
  });

  await t('lists a service and creates an order that needs onchain payment', async () => {
    svc = (await api('POST', `/agents/${agent.id}/services`, to, { title: 'Brief', category: 'company_research', price: '5' })).body;
    const r = await api('POST', '/orders', tb, { serviceId: svc.id, target: 'NVDA' });
    assert.equal(r.status, 201); assert.equal(r.body.payment.canPayOnchain, true); order = r.body;
    assert.equal((await api('POST', `/orders/${order.order.id}/demo-pay`, tb)).status, 403, 'simulated pay disabled in production mode');
  });

  const pay = async (signer, o, amount) => {
    await (await usdc.connect(D).mint(signer.address, 100_000_000n)).wait();
    await (await usdc.connect(signer).approve(await mkt.getAddress(), 100_000_000n)).wait();
    const tx = await mkt.connect(signer).payForOrder(o.payment.orderIdBytes32, o.payment.agentOnchainId, amount); await tx.wait(); return tx.hash;
  };

  await t('payment with the WRONG AMOUNT is rejected', async () => {
    const hash = await pay(B, order, 1_000_000n); // underpay
    const r = await api('POST', `/orders/${order.order.id}/confirm`, tb, { txHash: hash });
    assert.equal(r.status, 400); assert.match(r.body.error, /does not match/i);
  });
  // the underpay consumed this orderId onchain, so use a fresh order for the happy path
  let order2;
  await t("someone else's payment cannot be claimed by a different wallet", async () => {
    order2 = (await api('POST', '/orders', tb, { serviceId: svc.id, target: 'NVDA' })).body;
    const hash = await pay(B, order2, 5_000_000n);
    const r = await api('POST', `/orders/${order2.order.id}/confirm`, tm, { txHash: hash }); // mallory is not the buyer of this order
    assert.equal(r.status, 403);
  });
  await t('correct payment is verified, research runs, order completes', async () => {
    const hash = await pay(B, { payment: order2.payment }, 0n).catch(() => null); // orderId already paid -> reverts (replay protection onchain)
    assert.equal(hash, null);
    const paid = (await usdc.queryFilter(usdc.filters.Transfer(B.address, owner.address))).pop();
    const mine = (await provider.getTransactionReceipt(paid.transactionHash));
    const r = await api('POST', `/orders/${order2.order.id}/confirm`, tb, { txHash: mine.hash });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'processing');
    await worker.tick();
    const o = (await api('GET', `/orders/${order2.order.id}`, tb)).body;
    assert.equal(o.status, 'completed'); assert.ok(o.reportId);
    assert.equal((await usdc.balanceOf(owner.address)), 6_000_000n); // 1 (underpay) + 5 straight to the agent owner
  });
  await t('a payment tx cannot be replayed on another order', async () => {
    const o3 = (await api('POST', '/orders', tb, { serviceId: svc.id, target: 'AAPL' })).body;
    const paid = (await usdc.queryFilter(usdc.filters.Transfer(B.address, owner.address))).pop();
    const r = await api('POST', `/orders/${o3.order.id}/confirm`, tb, { txHash: paid.transactionHash });
    assert.equal(r.status, 409); assert.match(r.body.error, /already used/i);
  });
  await t('garbage tx hash is rejected', async () => {
    const o4 = (await api('POST', '/orders', tb, { serviceId: svc.id, target: 'AAPL' })).body;
    assert.equal((await api('POST', `/orders/${o4.order.id}/confirm`, tb, { txHash: '0x123' })).status, 400);
  });

  console.log(`\n${n} onchain tests passed`);
  app.close(); await srv.close(); process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e.message, '\n', e.stack); process.exit(1); });
