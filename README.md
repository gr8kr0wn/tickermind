# TickerMind

AI agents that research companies, sell financial intelligence for USDC, and manage their own treasuries on Base.

**Track:** Agentic Stock Finance · **Network:** Base Sepolia · **Stack:** plain HTML/CSS/JS + Vercel functions + Supabase + Solidity

```
Create agent → Configure → Research → Sell reports → Earn USDC → Allocate (paper) → Monitor
```

## What's in the box

| Folder | What it is |
|---|---|
| `contracts/` | Foundry project: `AgentRegistry`, `AgentVault`, `AgentMarketplace` + tests + deploy script |
| `supabase/migrations/001_init.sql` | Database schema (run once) |
| `web/public/` | The website: plain HTML, CSS, JS. No framework, no build step |
| `web/api/` | 10 serverless functions (plain JS) — auth, agents, services, orders, research, reports, treasury, leaderboard, stats, config |
| `web/lib/` | Server code: research engine, chain helpers, LLM fallback chain, Supabase |

### How the pieces fit

- **Identity:** each agent is registered in `AgentRegistry` → unique onchain ID owned by your wallet.
- **Research engine:** pulls verified numbers from **Finnhub** and **SEC EDGAR** (every fact keeps its source link), then **Gemini** (falling back to a lighter Gemini model, then **Groq**) writes the interpretation using *only* those facts. Facts and AI opinion are kept visually separate.
- **Marketplace:** buyers pay USDC into escrow (`AgentMarketplace.purchase`). The backend runs the research, checks quality (≥4 sourced facts), then the operator wallet calls `fulfill(orderId, reportHash)` — payment goes to the seller's vault and the report's keccak256 hash is written onchain. If anything fails, the buyer is refunded automatically (or can self-refund after 24h).
- **Agent-to-agent economy:** an agent can buy from another agent with its *own treasury* (`purchaseAsAgent`), not your wallet.
- **Treasury:** `AgentVault` holds real USDC and the owner's allocation policy (e.g. 40/20/40). The agent recommends how to fill its **paper** stock sleeve, weighted by its own research scores. Real money = solid fills. Simulated = hatched. No real or tokenized stocks are ever bought.
- **Leaderboard:** ranked by verified revenue, completed tasks, ratings and reliability — never by paper returns.

---

## Setup (≈30 minutes, all free)

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → paste `supabase/migrations/001_init.sql` → Run.
3. Project Settings → API → copy the **Project URL** and the **service_role** key.

### 2. API keys
- **Finnhub:** [finnhub.io](https://finnhub.io) → free API key
- **Gemini:** [aistudio.google.com](https://aistudio.google.com) → Get API key. Check which Flash models your project has on the free tier and set `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` to match.
- **Groq (backup):** [console.groq.com/keys](https://console.groq.com/keys)

### 3. Wallets + testnet funds
Create **two new wallets** (don't reuse your main one):
- **Deployer** — pays gas to deploy contracts once.
- **Operator** — the backend wallet that releases escrow and refunds. Its private key goes in `web/.env`.

Fund both with Base Sepolia ETH (any Base Sepolia faucet, e.g. the Coinbase Developer Platform faucet). Get test USDC for your buyer wallet at [faucet.circle.com](https://faucet.circle.com) (pick Base Sepolia).

### 4. Deploy the contracts

**Easiest (phone works):** run the site (step 5 or 6), then open `/deploy` inside your wallet's browser (Coinbase Wallet or MetaMask app). It deploys all 3 contracts from your wallet, can generate + fund a fresh operator wallet, and gives you the `.env` lines to copy. You need ~0.01 Base Sepolia ETH. The site runs fine before contracts exist.

**Or with Foundry:**

```bash
cd contracts
forge install foundry-rs/forge-std --no-git   # add --no-commit instead if this folder is a git repo
cp .env.example .env                           # fill DEPLOYER_PRIVATE_KEY + OPERATOR_ADDRESS
forge test                                     # 10 tests should pass
source .env
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast
```
Copy the four printed addresses into `web/.env`, then restart the site.

### 5. Run the site locally
```bash
cd web
cp .env.example .env     # fill everything
npm install
npm run dev              # → http://localhost:3000
```

### 6. Deploy to Vercel
1. Push the repo to GitHub → import it in Vercel.
2. **Root Directory:** `web` · Framework preset: **Other** (no build command).
3. Add every variable from `web/.env` under Settings → Environment Variables.
4. Deploy.

---

## Demo script (for judges)
1. **Connect wallet** → sign in (signature only, no gas).
2. **Create** → name `NVIDIA BRAIN`, pick Technology, Balanced policy, list a 5 USDC service → **Deploy to Base** (registers the agent onchain and lists its service).
3. On the agent page → **Research** `NVDA` → review the draft → **Approve & publish**.
4. From a second wallet → **Marketplace** → **Request** → pay 5 USDC → the agent researches live → report opens with the **Verification** panel showing that its hash matches Base.
5. Back on the agent → **Treasury**: real USDC (solid) vs paper portfolio (hatched) → **Run allocation** → **Apply**.
6. Create a second agent and buy from the first **using the agent's treasury** — that's agent-to-agent commerce.
7. **Ranks** → leaderboard by verified revenue.

## Notes & limits
- Free tiers: Finnhub ≈60 calls/min. Gemini free limits vary per project. Owner research is cached for 6 hours per ticker to save quota.
- SEC EDGAR covers US filers (10-K/10-Q). Foreign filers still get Finnhub facts.
- `Execute trades` is locked in the MVP by design. Portfolios are simulated.
- Rebuilding the bundled viem file (only if you upgrade viem): `npm run bundle:viem`.

Not financial advice.
