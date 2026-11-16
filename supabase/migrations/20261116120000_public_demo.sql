-- Public homepage demo: one row per request (for the per-IP and daily limits, the 30-day result cache
-- and the cost line on /admin). No personal data: the visitor's IP is stored only as a salted hash,
-- and rows are deleted after 30 days (retention job).

create table public.demo_runs (
  id          bigint generated always as identity primary key,
  ip_hash     text not null,
  domain      text not null,
  sells       text not null default '',
  status      text not null default 'running' check (status in ('running', 'done', 'no_facts', 'failed', 'timeout', 'cached')),
  result      jsonb,
  cost_usd    numeric(12, 6) not null default 0,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index demo_runs_created_idx on public.demo_runs (created_at);
create index demo_runs_ip_idx on public.demo_runs (ip_hash, created_at);
create index demo_runs_domain_idx on public.demo_runs (domain, sells, created_at desc);
alter table public.demo_runs enable row level security;  -- server only

-- Demo costs are tagged, so /admin can show them and keep them out of customer margins.
alter table public.usage_costs add column demo_run_id bigint references public.demo_runs (id) on delete set null;
create index usage_costs_demo_idx on public.usage_costs (demo_run_id) where demo_run_id is not null;
