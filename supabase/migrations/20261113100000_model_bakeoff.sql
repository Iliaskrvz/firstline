-- Model bake-off (Quality Lab): runs, and their real costs in usage_costs.
-- Lab calls belong to no customer workspace, so usage_costs.workspace_id may be empty for them
-- (members never see those rows: RLS needs a workspace they belong to).

alter table public.usage_costs alter column workspace_id drop not null;
alter table public.usage_costs drop constraint if exists usage_costs_step_check;
alter table public.usage_costs add constraint usage_costs_step_check
  check (step in ('scrape', 'extract', 'write', 'validate', 'judge', 'search', 'places', 'compare', 'fact_check'));

create table public.bakeoff_runs (
  id           bigint generated always as identity primary key,
  test_set_ids text[] not null,
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'over_budget', 'failed')),
  provider     text,                                   -- 'fake' = test output, no AI used
  budget_usd   numeric(8, 2) not null,
  cost_usd     numeric(12, 6) not null default 0,
  progress     jsonb not null default '{}'::jsonb,     -- phase, done, total, spent, projected
  report       jsonb,                                  -- cost vs quality per writer, extraction, judge agreement, blind sheet
  records      jsonb,                                  -- per lead: every writer's email, scores and verdicts
  picks        jsonb not null default '{}'::jsonb,     -- the owner's blind picks: {"1": "a", "2": "same", ...}
  approved_by  text not null,                          -- the admin who approved the spend
  error        text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
alter table public.bakeoff_runs enable row level security;  -- server only (admin pages use the server pool)

alter table public.usage_costs add column bakeoff_run_id bigint references public.bakeoff_runs (id) on delete set null;
create index usage_costs_bakeoff_idx on public.usage_costs (bakeoff_run_id) where bakeoff_run_id is not null;
