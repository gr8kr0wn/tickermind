-- TickerMind schema (Supabase / PostgreSQL). Run once in the Supabase SQL editor.
-- All token amounts are BIGINT in smallest units (USDC = 6 decimals). No floats for money.
-- The API uses the service-role key; RLS is enabled with no public policies so the
-- browser can never read/write tables directly.

create extension if not exists "pgcrypto";

create table if not exists tm_agents (
  id uuid primary key default gen_random_uuid(),
  owner_wallet text not null,
  onchain_agent_id bigint,
  register_tx text,
  name text not null,
  description text default '',
  specialization text not null default 'general',
  avatar text default '',
  status text not null default 'active'
    check (status in ('pending','configuring','active','paused','processing','failed','archived')),
  config jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists agents_owner_idx on tm_agents (owner_wallet);

create table if not exists tm_tasks (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references tm_agents(id) on delete cascade,
  task_type text not null
    check (task_type in ('company_research','earnings_analysis','industry_analysis','market_summary')),
  target text not null,
  status text not null default 'pending'
    check (status in ('pending','processing','completed','failed')),
  requested_by text,
  order_id uuid,
  error text,
  report_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists tasks_status_idx on tm_tasks (status, created_at);

create table if not exists tm_reports (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references tm_agents(id) on delete cascade,
  task_id uuid references tm_tasks(id) on delete set null,
  company text not null,
  ticker text not null,
  report_data jsonb not null,
  sources jsonb not null default '[]',
  status text not null default 'published' check (status in ('draft','published')),
  quality_score int default 0,
  created_at timestamptz not null default now()
);

create table if not exists tm_services (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references tm_agents(id) on delete cascade,
  title text not null,
  description text default '',
  category text not null
    check (category in ('company_research','earnings_analysis','industry_research','market_intelligence')),
  price bigint not null check (price > 0),           -- micro-USDC
  currency text not null default 'USDC',
  est_minutes int not null default 5,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists tm_orders (
  id uuid primary key default gen_random_uuid(),
  buyer text not null,                                -- wallet address, or "agent:<id>" for A2A
  service_id uuid not null references tm_services(id),
  agent_id uuid not null references tm_agents(id),
  target text not null,
  amount bigint not null,
  tx_hash text,
  status text not null default 'pending_payment'
    check (status in ('pending_payment','paid','processing','delivered','completed','refunded')),
  kind text not null default 'human' check (kind in ('human','a2a','demo')),
  report_id uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists orders_tx_unique on tm_orders (tx_hash) where tx_hash is not null;

-- A2A: one agent asks another agent for research. Needs owner approval.
create table if not exists tm_a2a_requests (
  id uuid primary key default gen_random_uuid(),
  from_agent uuid not null references tm_agents(id),
  to_agent uuid not null references tm_agents(id),
  service_id uuid not null references tm_services(id),
  target text not null,
  amount bigint not null,
  status text not null default 'pending_approval'
    check (status in ('pending_approval','approved','rejected','completed','failed')),
  order_id uuid,
  created_at timestamptz not null default now()
);

-- Double-entry ledger. Every tx_id must have SUM(debit) = SUM(credit).
-- Accounts per agent: unallocated, reserve, operating, sim_stocks.
-- Counter accounts: external:revenue, external:faucet, external:expenses.
create table if not exists tm_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  tx_id uuid not null,
  agent_id uuid references tm_agents(id),
  account text not null,
  debit bigint not null default 0 check (debit >= 0),
  credit bigint not null default 0 check (credit >= 0),
  currency text not null default 'USDC',
  tx_type text not null,
  reference text,
  status text not null default 'posted',
  created_at timestamptz not null default now(),
  check ((debit = 0) <> (credit = 0))
);
create index if not exists ledger_agent_idx on tm_ledger_entries (agent_id, account);
create index if not exists ledger_tx_idx on tm_ledger_entries (tx_id);

-- Simulated portfolio (hypothetical tm_positions, NOT tokenized stocks).
create table if not exists tm_positions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references tm_agents(id) on delete cascade,
  ticker text not null,
  shares bigint not null,        -- micro-shares (1e6 = 1 share)
  cost_micro bigint not null,    -- total cost in micro-USD
  bench_units bigint not null,   -- micro-shares of SPY bought with the same cash (benchmark)
  price_micro bigint not null,   -- price per share in micro-USD at buy
  price_source text,             -- stooq or synthetic
  created_at timestamptz not null default now()
);
create index if not exists positions_agent_idx on tm_positions (agent_id);

alter table tm_agents enable row level security;
alter table tm_tasks enable row level security;
alter table tm_reports enable row level security;
alter table tm_services enable row level security;
alter table tm_orders enable row level security;
alter table tm_a2a_requests enable row level security;
alter table tm_ledger_entries enable row level security;
alter table tm_positions enable row level security;
