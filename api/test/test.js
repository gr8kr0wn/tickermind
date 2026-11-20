// End-to-end API test: real HTTP, fresh local DB, no network required (research falls back to
// "missing data" reports offline; with network it uses live SEC/Stooq/news data).
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
process.env.LOCAL_DB_FILE = path.join(os.tmpdir(), 'tm-test-' + Date.now() + '.json');
process.env.DEMO_MODE = '1';
process.env.SESSION_SECRET = 'test-secret';
process.env.SCHEDULER_ENABLED = '0';
delete process.env.SUPABASE_URL;

const { ethers } = require('ethers');
const { createApp } = require('../src/server');
const { seed } = require('../src/seed');
const worker = require('../src/worker');
const ledger = require('../src/ledger');
const db = require('../src/db');
const { parseUnits } = require('../src/money');

let base;
let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ok -', name); };

async function api(method, url, { token, body } = {}) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}
async function login(wallet) {
  const n = await api('GET', '/api/auth/nonce');
  const sig = await wallet.signMessage(n.body.message);
  const v = await api('POST', '/api/auth/verify', { body: { address: wallet.address, signature: sig, nonce: n.body.nonce } });
  assert.equal(v.status, 200);
  return v.body.token;
}
const agentBody = (name, extra = {}) => ({ name, description: 'test agent', specialization: 'technology', avatar: 2, researchTargets: ['NVDA', 'AAPL'], researchFrequency: 'on_demand', ...extra });

(async () => {
  await seed({ withReports: false });
  const server = createApp().listen(0);
  base = 'http://127.0.0.1:' + server.address().port;

  const alice = ethers.Wallet.createRandom();
  const bob = ethers.Wallet.createRandom();
  const ta = await login(alice);
  const tb = await login(bob);
  let agent, service;

  await t('health + config are public', async () => {
    assert.equal((await api('GET', '/api/health')).body.ok, true);
    assert.equal((await api('GET', '/api/config')).body.chainId, 84532);
  });

  await t('auth: protected route rejects missing/garbage token', async () => {
    assert.equal((await api('POST', '/api/agents', { body: agentBody('X1') })).status, 401);
    assert.equal((await api('POST', '/api/agents', { token: 'garbage.token', body: agentBody('X1') })).status, 401);
  });

  await t('agent creation validates allocation = 100%', async () => {
    const bad = await api('POST', '/api/agents', { token: ta, body: agentBody('Bad One', { allocationPolicy: { reservePercentage: 40, simulatedStockPercentage: 40, operatingPercentage: 10 } }) });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /100/);
    assert.equal((await api('POST', '/api/agents', { token: ta, body: agentBody('Bad Spec', { specialization: 'crypto' }) })).status, 400);
  });

  await t('creates an agent and grants a simulated starter balance', async () => {
    const r = await api('POST', '/api/agents', { token: ta, body: agentBody('ALICE ALPHA', { allocationPolicy: { reservePercentage: 40, simulatedStockPercentage: 40, operatingPercentage: 20 } }) });
    assert.equal(r.status, 201);
    agent = r.body;
    const tr = await api('GET', `/api/agents/${agent.id}/treasury`);
    assert.equal(tr.body.balances.operating, '100000000');
    assert.equal(tr.body.simulated, true);
  });

  await t("non-owner cannot edit or add services to someone's agent", async () => {
    assert.equal((await api('PATCH', `/api/agents/${agent.id}`, { token: tb, body: { status: 'paused' } })).status, 403);
    assert.equal((await api('POST', `/api/agents/${agent.id}/services`, { token: tb, body: { title: 'Nope', category: 'company_research', price: '1' } })).status, 403);
  });

  await t('owner lists a service; invalid price rejected', async () => {
    assert.equal((await api('POST', `/api/agents/${agent.id}/services`, { token: ta, body: { title: 'Cheap', category: 'company_research', price: '0.001' } })).status, 400);
    const r = await api('POST', `/api/agents/${agent.id}/services`, { token: ta, body: { title: 'Company deep-dive', description: 'x', category: 'company_research', price: '5', estMinutes: 3 } });
    assert.equal(r.status, 201);
    service = r.body;
    assert.equal(service.price, '5000000');
    const m = await api('GET', '/api/services');
    assert.ok(m.body.some((s) => s.id === service.id));
  });

  let order;
  await t('buyer orders, pays (simulated), worker delivers a report and revenue is split by policy', async () => {
    const c = await api('POST', '/api/orders', { token: tb, body: { serviceId: service.id, target: 'NVDA' } });
    assert.equal(c.status, 201);
    assert.equal(c.body.order.status, 'pending_payment');
    order = c.body.order;
    // only the buyer can pay
    assert.equal((await api('POST', `/api/orders/${order.id}/demo-pay`, { token: ta })).status, 403);
    const p = await api('POST', `/api/orders/${order.id}/demo-pay`, { token: tb });
    assert.equal(p.body.status, 'processing');
    // cannot pay twice
    assert.equal((await api('POST', `/api/orders/${order.id}/demo-pay`, { token: tb })).status, 409);
    await worker.tick();
    const o = await api('GET', `/api/orders/${order.id}`, { token: tb });
    assert.equal(o.body.status, 'completed', JSON.stringify(o.body));
    assert.ok(o.body.reportId);
    const rep = await api('GET', `/api/reports/${o.body.reportId}`);
    assert.equal(rep.status, 200);
    assert.ok(rep.body.report.disclaimer);
    assert.ok(Array.isArray(rep.body.report.missingData));
    const tr = (await api('GET', `/api/agents/${agent.id}/treasury`)).body;
    // 100 starter + 5 revenue: reserve 2, operating 100 + 1 - 0.05 compute, stocks 2
    assert.equal(tr.balances.reserve, '2000000');
    assert.equal(tr.balances.operating, String(100_000_000 + 1_000_000 - 50_000));
    assert.equal(tr.balances.simStocks, '2000000');
    assert.equal(tr.revenue, '5000000');
    assert.equal(tr.expenses, '50000');
  });

  await t('ledger stays balanced after every flow', async () => {
    const inv = await ledger.checkInvariants();
    assert.deepEqual(inv.broken, []);
    assert.equal(inv.escrow, 0n);
  });

  await t('portfolio is clearly simulated and values are integers', async () => {
    const pf = (await api('GET', `/api/agents/${agent.id}/portfolio`)).body;
    assert.equal(pf.simulated, true);
    assert.match(pf.note, /not real/i);
    assert.doesNotThrow(() => BigInt(pf.totalValue));
  });

  let a2a;
  await t('A2A: request needs approval, funds go to escrow, released to provider on completion', async () => {
    const agents = (await api('GET', '/api/agents')).body;
    const scout = agents.find((a) => a.name === 'MARKET SCOUT');
    const svc = (await api('GET', '/api/services?category=industry_research')).body.find((s) => s.agentId === scout.id);
    const before = (await api('GET', `/api/agents/${agent.id}/treasury`)).body.balances;
    const scoutBefore = (await api('GET', `/api/agents/${scout.id}/treasury`)).body.balances;
    // someone else cannot spend my agent's funds
    assert.equal((await api('POST', '/api/a2a', { token: tb, body: { fromAgentId: agent.id, serviceId: svc.id, target: 'semiconductors' } })).status, 403);
    const c = await api('POST', '/api/a2a', { token: ta, body: { fromAgentId: agent.id, serviceId: svc.id, target: 'semiconductors' } });
    assert.equal(c.status, 201);
    a2a = c.body;
    assert.equal(a2a.status, 'pending_approval');
    // nothing moved yet
    assert.equal((await api('GET', `/api/agents/${agent.id}/treasury`)).body.balances.operating, before.operating);
    const ap = await api('POST', `/api/a2a/${a2a.id}/approve`, { token: ta });
    assert.equal(ap.body.status, 'approved');
    assert.equal((await api('GET', `/api/agents/${agent.id}/treasury`)).body.balances.operating, String(BigInt(before.operating) - 4_000_000n));
    assert.equal((await ledger.checkInvariants()).escrow, 4_000_000n); // held in escrow
    assert.equal((await api('POST', `/api/a2a/${a2a.id}/approve`, { token: ta })).status, 409); // no double approve
    await worker.tick();
    const done = (await api('GET', `/api/a2a?agentId=${agent.id}`)).body.find((x) => x.id === a2a.id);
    assert.equal(done.status, 'completed');
    const scoutAfter = (await api('GET', `/api/agents/${scout.id}/treasury`)).body.balances;
    // provider got 4 USDC: reserve 1.6, stocks 1.6, operating 0.8 - 0.05 compute
    assert.equal(BigInt(scoutAfter.reserve) - BigInt(scoutBefore.reserve), 1_600_000n);
    assert.equal(BigInt(scoutAfter.operating) - BigInt(scoutBefore.operating), 800_000n - 50_000n);
    const inv = await ledger.checkInvariants();
    assert.deepEqual(inv.broken, []);
    assert.equal(inv.escrow, 0n);
  });

  await t('A2A: insufficient simulated funds is rejected up front', async () => {
    const carol = ethers.Wallet.createRandom();
    const tc = await login(carol);
    const r = await api('POST', '/api/agents', { token: tc, body: agentBody('POOR AGENT', { permissions: { requestServices: true } }) });
    // drain operating balance to zero via the ledger
    const bal = await ledger.balances(r.body.id);
    await ledger.expense(r.body.id, bal.operating, 'test-drain');
    const scout = (await api('GET', '/api/agents')).body.find((a) => a.name === 'MARKET SCOUT');
    const svc = (await api('GET', '/api/services?category=industry_research')).body.find((s) => s.agentId === scout.id);
    const bad = await api('POST', '/api/a2a', { token: tc, body: { fromAgentId: r.body.id, serviceId: svc.id, target: 'energy' } });
    assert.equal(bad.status, 400);
  });

  await t('A2A: requester without requestServices permission is blocked', async () => {
    const dan = ethers.Wallet.createRandom();
    const td = await login(dan);
    const r = await api('POST', '/api/agents', { token: td, body: agentBody('NO PERMS', { permissions: { requestServices: false } }) });
    const svc = (await api('GET', '/api/services')).body[0];
    assert.equal((await api('POST', '/api/a2a', { token: td, body: { fromAgentId: r.body.id, serviceId: svc.id, target: 'x' } })).status, 403);
  });

  await t('one-click demo A2A endpoint runs the full agent-to-agent flow', async () => {
    const r = await api('POST', '/api/demo/a2a', { body: { target: 'semiconductor' } });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'approved');
    await worker.tick();
    assert.equal((await api('GET', '/api/a2a')).body.find((x) => x.id === r.body.id).status, 'completed');
    assert.deepEqual((await ledger.checkInvariants()).broken, []);
  });

  await t('paused agents cannot take orders; leaderboard + stats respond', async () => {
    await api('PATCH', `/api/agents/${agent.id}`, { token: ta, body: { status: 'paused' } });
    assert.equal((await api('POST', '/api/orders', { token: tb, body: { serviceId: service.id, target: 'AAPL' } })).status, 409);
    const lb = await api('GET', '/api/leaderboard');
    assert.equal(lb.status, 200);
    assert.ok(lb.body.revenue.length >= 1);
    const st = await api('GET', '/api/stats');
    assert.ok(st.body.agents >= 5);
  });

  await t('dashboard (/me) aggregates only my agents', async () => {
    const me = (await api('GET', '/api/me', { token: ta })).body;
    assert.equal(me.totals.agents, 1);
    assert.ok(me.agents.every((a) => a.owner === alice.address.toLowerCase()));
    assert.equal(me.totals.revenue, '5000000');
  });

  await t('draft reports are hidden from the public', async () => {
    await api('PATCH', `/api/agents/${agent.id}`, { token: ta, body: { status: 'active', permissions: { publishReports: false } } });
    const tk = await api('POST', `/api/agents/${agent.id}/tasks`, { token: ta, body: { taskType: 'company_research', target: 'AAPL' } });
    assert.equal(tk.status, 202);
    await worker.tick();
    const task = (await api('GET', `/api/tasks/${tk.body.id}`)).body;
    assert.equal(task.status, 'completed', JSON.stringify(task));
    assert.equal((await api('GET', `/api/reports/${task.reportId}`)).status, 404);
    assert.equal((await api('GET', `/api/reports/${task.reportId}`, { token: ta })).status, 200);
  });

  console.log(`\n${passed} API tests passed`);
  server.close();
  try { fs.unlinkSync(process.env.LOCAL_DB_FILE); } catch (_) {}
  process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e.message); console.error(e.stack); process.exit(1); });
