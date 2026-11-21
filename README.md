# TickerMind

AI research agents that sell reports, pay each other, and run a practice treasury.
Built for the Stocks Maxxing hackathon (Agentic Stock Finance track) on **Base**.

> **Sandbox by design.** Base Sepolia, testnet USDC, simulated portfolios. No real stock trades,
> no personal investment advice, and agents never get unrestricted control of funds.
> Everything simulated is labelled **Simulated** in the UI.

## Run it in 60 seconds

```bash
npm install
cp .env.example .env      # optional for a first look, the app runs with zero keys
npm start                 # http://localhost:3000
```

With no keys it runs on a local JSON database, rule-based reports and simulated payments.
Open the home page and press **Watch them trade**: one demo agent hires another, money is held in
escrow, the research runs, and the payment is released. That is the whole product in 20 seconds.

## What you fill in (.env)

| Variable | What it does | Where to get it (all free) |
|---|---|---|
| `SESSION_SECRET` | Signs wallet sessions | `openssl rand -hex 32` |
| `LLM_API_KEY` | Writes the report text | console.groq.com (free tier) |
| `SEC_USER_AGENT` | Required by SEC EDGAR | your name + email |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Persistent database | free Supabase project, then run `supabase/schema.sql` |
| `AGENT_REGISTRY_ADDRESS`, `MARKETPLACE_ADDRESS` | Onchain contracts | printed by `npm run contracts:deploy` |
| `DEPLOYER_PRIVATE_KEY` | Deploys contracts (local machine only) | a throwaway wallet with Base Sepolia ETH |

## Deploy the contracts (Base Sepolia)

1. Fund a throwaway wallet with Base Sepolia ETH from any faucet.
2. Put its key in `.env` as `DEPLOYER_PRIVATE_KEY`.
3. `npm run contracts:deploy` (plain Node, no Foundry needed, works on Termux).
4. Copy the two printed addresses into `.env`. Remove `DEPLOYER_PRIVATE_KEY` afterwards.
5. Buyers get testnet USDC at faucet.circle.com (choose Base Sepolia).

## Deploy the app (Supabase only)

The backend runs as one Supabase Edge Function, and the database is Supabase Postgres (tables prefixed `tm_`).

1. Apply `supabase/migrations/001_tickermind_tables.sql` to your project.
2. Build and deploy the function: `npm run build:edge`, then deploy `supabase/functions/tickermind-api` (JWT verification off).
3. Add secrets in the dashboard: `LLM_API_KEY` (Groq, free), `SEC_USER_AGENT` (your email), optional `STOOQ_API_KEY`.
4. Add a pg_cron job (pg_cron + pg_net) that calls `/functions/v1/tickermind-api/api/internal/tick` every 30 seconds.
5. Host `web/` on any static host. `web/js/api.js` points at the function URL (change `API_BASE` if yours differs).

Deployed contracts (Base Sepolia): AgentRegistry `0x86E368dEe7194756528D2f6C7Cd57c63333d030d`, Marketplace `0xF4eA5a89E613eAb3196333B76763a12039E35E25`.

## How it works

```
Browser (plain HTML/CSS/JS, no build)
   |  wallet sign-in (signed nonce, no gas)
Node API ──► Worker queue ──► Research engine ──► Report
   |                              SEC EDGAR · Stooq prices · news RSS · free LLM
   ├── Ledger (double-entry, integer micro-USDC) ── Supabase / JSON
   └── Base Sepolia: AgentRegistry + Marketplace (USDC settles straight to the agent owner)
```

- **Agents**: created in a 3-step wizard, registered on Base, with explicit permission switches
  and an allocation policy (reserve / practice stocks / operating) that always totals 100%.
- **Research**: every request is a queued task, no HTTP request is held open. Facts come from
  providers only. The LLM may phrase and interpret them, and a numeric guard strips any figure
  that is not in the retrieved facts. Reports list sources with publish and fetch dates, flag
  missing data, and label interpretations as AI-generated.
- **Marketplace**: pay with testnet USDC (`approve` then `payForOrder`). The server verifies the
  receipt: chain, token, amount, recipient, buyer, agent and order id. Replays are rejected.
- **Agent-to-agent**: an agent hires another agent. It needs the `requestServices` permission,
  enough operating funds, and the owner's explicit approval. Funds sit in escrow and are released
  only when the research is delivered, or refunded if it fails.
- **Treasury**: double-entry ledger, integer math only. Revenue is split by the agent's policy
  with the remainder going to operating, so no dust is lost.
- **Portfolio**: hypothetical positions marked to market, compared with SPY. Realized P/L is
  always 0 because the MVP never sells.

## Tests

```bash
npm test
```

(A `µWS is not compatible` line from ganache is harmless: it falls back to pure Node.)

48 tests: contracts on a local chain, provider parsing with mocked SEC/Stooq/RSS payloads, the LLM
numeric guard, full API flows (auth, permissions, orders, escrow, ledger invariants), and an onchain
suite that deploys the real contracts and attacks the payment verifier (underpay, wrong buyer, replay).

## Honest limits

- Live SEC, Stooq and news fetching is covered by mocked tests, but was **not run against the real
  sites** during the build (the build sandbox blocks them). Run one real report before you demo.
- The browser wallet flow (connect, register, pay) was tested with real contracts through the API,
  but not clicked through with a real MetaMask. Do one end-to-end pass on Base Sepolia before the demo.
- No refund automation for failed human-paid orders: the owner refunds manually (simulated and
  agent-to-agent payments are refunded automatically).
- Single-process worker and in-process locks: run one instance. Scale-out needs a real queue.
- Not implemented from the original spec: separate AgentVault/AllocationManager contracts (the
  allocation policy lives in `AgentRegistry`, balances in the ledger) and conflicting-source detection.

## Layout

```
web/        static frontend (index.html, css, js modules)
api/src/    server, routes, ledger, research engine, worker, chain verification
api/test/   API, provider and onchain tests
contracts/  Solidity, node compile/deploy/test scripts
supabase/   schema.sql
```
