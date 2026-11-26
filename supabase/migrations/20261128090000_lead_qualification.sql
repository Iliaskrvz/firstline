-- Part B: AI lead qualification. Before writing, the fast model checks whether a lead fits the
-- campaign's target customer. No fit = no email, no credits.

-- 1. The campaign's target customer (null = qualification off): { fits, excludes, strictness }.
alter table public.campaigns add column target_customer jsonb
  check (target_customer is null or (target_customer ? 'strictness' and target_customer->>'strictness' in ('strict', 'normal', 'loose')));

-- 2. The verdict per lead (also what the customer sees and can override with "write anyway").
alter table public.leads
  add column qualify_verdict  text check (qualify_verdict in ('fit', 'no_fit', 'unsure')),
  add column qualify_reason   text,
  add column qualify_facts    text[] not null default '{}',
  add column qualify_criteria jsonb,                      -- { met: [...], not_met: [...] }
  add column qualify_override boolean not null default false;  -- "write anyway": skip qualification for this lead

create index leads_qualify_idx on public.leads (campaign_id, qualify_verdict) where qualify_verdict is not null;

-- 3. Cache per campaign + domain + the target-customer text (fingerprint): a verdict is never reused
--    across campaigns, and editing the target text gives new verdicts. Server only.
create table public.qualification_cache (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  domain      text not null,
  target_hash text not null,
  verdict     jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (campaign_id, domain, target_hash)
);
alter table public.qualification_cache enable row level security;
revoke all on public.qualification_cache from anon, authenticated;

-- 4. Its AI call is a cost step of its own.
alter table public.usage_costs drop constraint if exists usage_costs_step_check;
alter table public.usage_costs add constraint usage_costs_step_check
  check (step in ('scrape', 'extract', 'write', 'validate', 'judge', 'search', 'places', 'compare', 'fact_check', 'qualify'));

-- 5. Anonymous outcome rows keep the verdict, to see later whether "fit" leads reply more.
alter table public.outcomes add column qualify_verdict text;
create or replace function public.outcome_qualify_verdict() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.qualify_verdict is null and new.lead_id is not null then
    select l.qualify_verdict into new.qualify_verdict from public.leads l where l.id = new.lead_id;
  end if;
  return new;
end;
$$;
create trigger outcomes_qualify_verdict before insert on public.outcomes
  for each row execute function public.outcome_qualify_verdict();

-- 6. Quality Lab: the qualification test. 50 or so leads labelled by hand ("should fit: yes/no") are
--    researched and checked; the report gives accuracy, the false no_fit rate and the cost per lead.
--    Queued only by an admin who approved the spend; costs go to usage_costs like the bake-off's.
create table public.qualify_test_runs (
  id           bigint generated always as identity primary key,
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'over_budget', 'failed')),
  provider     text,                                   -- 'fake' = test output, no AI used
  budget_usd   numeric(8, 2) not null,
  cost_usd     numeric(12, 6) not null default 0,
  input        jsonb not null,                         -- the labelled leads from the CSV
  progress     jsonb not null default '{}'::jsonb,
  report       jsonb,
  approved_by  text not null,
  error        text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
alter table public.qualify_test_runs enable row level security;  -- server only (admin pages use the server pool)
revoke all on public.qualify_test_runs from anon, authenticated;

alter table public.usage_costs add column qualify_test_run_id bigint references public.qualify_test_runs (id) on delete set null;
create index usage_costs_qualify_test_idx on public.usage_costs (qualify_test_run_id) where qualify_test_run_id is not null;
