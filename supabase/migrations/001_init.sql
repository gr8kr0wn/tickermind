-- TickerMind schema. Run in Supabase → SQL Editor (or `supabase db push`).
-- All access goes through the server (service role key). RLS is enabled with
-- no public policies, so the anon key can read nothing.


-- ---------------------------------------------------------------- profiles
create table if not exists profiles (
  wallet       text primary key,               -- lowercase 0x address
  created_at   timestamptz not null default now(),
  last_login   timestamptz not null default now()
);

-- ---------------------------------------------------------------- agents
create table if not exists agents (
  id                uuid primary key default gen_random_uuid(),
  onchain_id        bigint unique,             -- AgentRegistry id, null until confirmed
  owner             text not null references profiles(wallet),
  name              text not null check (char_length(name) between 2 and 32),
  description       text not null default '',
  sector            text not null default 'general',
  strategy          text not null default 'long_term',
  frequency         text not null default 'on_demand',
  focus_tickers     text[] not null default '{}',
  policy_reserve    int  not null default 4000,
  policy_operating  int  not null default 2000,
  policy_simulated  int  not null default 4000,
  operating_budget  numeric not null default 0,  -- simulated operating budget (USDC)
  permissions       jsonb not null default '{"read_market":true,"generate_research":true,"publish_reports":"approval","receive_usdc":true,"recommend_allocations":true,"execute_transactions":false}',
  register_tx       text,
  status            text not null default 'draft' check (status in ('draft','active','paused')),
  created_at        timestamptz not null default now(),
  constraint policy_sums check (policy_reserve + policy_operating + policy_simulated = 10000)
);
create index if not exists agents_owner_idx on agents(owner);

-- ---------------------------------------------------------------- services
create table if not exists services (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null references agents(id) on delete cascade,
  onchain_service_id bigint unique,
  title              text not null,
  description        text not null default '',
  default_ticker     text,
  price_usdc         numeric not null check (price_usdc > 0),
  active             boolean not null default true,
  create_tx          text,
  created_at         timestamptz not null default now()
);
create index if not exists services_agent_idx on services(agent_id);

-- ---------------------------------------------------------------- reports
create table if not exists reports (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references agents(id) on delete cascade,
  ticker      text not null,
  title       text not null,
  content     jsonb not null,
  hash        text not null,                    -- keccak256 of canonical content
  origin      text not null default 'owner' check (origin in ('owner','order')),
  published   boolean not null default false,   -- owner reports need approval to publish
  model       text,
  created_at  timestamptz not null default now()
);
create index if not exists reports_agent_idx on reports(agent_id, created_at desc);

-- ---------------------------------------------------------------- orders
create table if not exists orders (
  id               uuid primary key default gen_random_uuid(),
  onchain_order_id bigint unique not null,
  service_id       uuid not null references services(id),
  seller_agent_id  uuid not null references agents(id),
  buyer_wallet     text not null,
  buyer_agent_id   uuid references agents(id),   -- set when an agent bought from another agent
  ticker           text not null,
  amount_usdc      numeric not null,
  purchase_tx      text unique not null,
  status           text not null default 'pending' check (status in ('pending','fulfilled','refunded','failed')),
  report_id        uuid references reports(id),
  fulfill_tx       text,
  rating           int check (rating between 1 and 5),
  error            text,
  created_at       timestamptz not null default now(),
  fulfilled_at     timestamptz
);
create index if not exists orders_seller_idx on orders(seller_agent_id, created_at desc);
create index if not exists orders_buyer_idx on orders(buyer_wallet, created_at desc);

-- ---------------------------------------------------------------- paper portfolio
create table if not exists paper_positions (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references agents(id) on delete cascade,
  ticker      text not null,
  shares      numeric not null,
  cost_basis  numeric not null,   -- simulated USD spent
  opened_at   timestamptz not null default now()
);
create index if not exists paper_agent_idx on paper_positions(agent_id);

create table if not exists allocations (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references agents(id) on delete cascade,
  balance_usdc  numeric not null,
  reserve       numeric not null,
  operating     numeric not null,
  simulated     numeric not null,
  picks         jsonb not null default '[]',
  rationale     text not null default '',
  applied       boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists alloc_agent_idx on allocations(agent_id, created_at desc);

-- ---------------------------------------------------------------- leaderboard view
create or replace view agent_stats with (security_invoker = true) as
select
  a.id as agent_id,
  coalesce(sum(o.amount_usdc) filter (where o.status = 'fulfilled'), 0) as revenue,
  count(o.id) filter (where o.status = 'fulfilled') as completed,
  count(o.id) filter (where o.status in ('refunded','failed')) as failed,
  count(o.id) filter (where o.status = 'pending') as pending,
  round(avg(o.rating)::numeric, 2) as avg_rating,
  (select count(*) from reports r where r.agent_id = a.id) as report_count
from agents a
left join orders o on o.seller_agent_id = a.id
where a.status <> 'draft'
group by a.id;

-- ---------------------------------------------------------------- lock down
alter table profiles        enable row level security;
alter table agents          enable row level security;
alter table services        enable row level security;
alter table reports         enable row level security;
alter table orders          enable row level security;
alter table paper_positions enable row level security;
alter table allocations     enable row level security;
revoke all on agent_stats from anon, authenticated;
