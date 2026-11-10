-- Phase 6: Economy mode (batches), admin margin view, Quality Lab, campaign end + data deletion.

-- ---------------------------------------------------------------------------
-- Economy mode: the first write of each lead waits for a batch (50% off).
-- Server only (RLS on, no policies); users see the lead's status instead.
-- ---------------------------------------------------------------------------
create table public.batch_jobs (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,                 -- 'anthropic' | 'fake'
  provider_batch_id text not null,
  campaign_id       uuid,
  status            text not null default 'submitted' check (status in ('submitted', 'ended', 'failed')),
  item_count        int not null default 0,
  created_at        timestamptz not null default now(),
  ended_at          timestamptz
);
alter table public.batch_jobs enable row level security;

create table public.batch_items (
  id           uuid primary key default gen_random_uuid(),   -- also the batch request's custom_id
  lead_id      uuid not null,
  workspace_id uuid not null,
  campaign_id  uuid not null,
  batch_job_id uuid references public.batch_jobs (id) on delete set null,
  status       text not null default 'pending' check (status in ('pending', 'submitted', 'done', 'error', 'consumed')),
  input        jsonb not null,      -- the writer request (provider-neutral)
  output       jsonb,
  costs        jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (lead_id, workspace_id) references public.leads (id, workspace_id) on delete cascade
);
-- One open item per lead.
create unique index batch_items_one_open_per_lead on public.batch_items (lead_id) where status <> 'consumed';
create index batch_items_status_idx on public.batch_items (status, campaign_id);
alter table public.batch_items enable row level security;

-- ---------------------------------------------------------------------------
-- Costs keep their campaign, also after the leads are deleted (margin per campaign).
-- ---------------------------------------------------------------------------
alter table public.usage_costs add column campaign_id uuid;
update public.usage_costs u set campaign_id = l.campaign_id from public.leads l where l.id = u.lead_id;
create index usage_costs_campaign_idx on public.usage_costs (campaign_id);
create index usage_costs_created_idx on public.usage_costs (created_at);

-- ---------------------------------------------------------------------------
-- Quality Lab (§7.4): a fixed test set; every new skill version runs on it and is
-- compared with the previous version. Admin only (RLS on, no policies).
-- ---------------------------------------------------------------------------
create table public.test_sets (
  id         text primary key,
  name       text not null,
  template   jsonb not null,     -- {subject, body, style_rules}
  leads      jsonb not null,     -- [{first_name, company, title, website, domain}]: no email addresses
  created_at timestamptz not null default now()
);
alter table public.test_sets enable row level security;

alter table public.eval_runs
  add column status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  add column details     jsonb not null default '[]'::jsonb,   -- per lead: both versions, checks, judge, winner
  add column error       text,
  add column cost_usd    numeric(12, 6) not null default 0,
  add column provider    text,                                -- 'fake' = test output, no AI used
  add column finished_at timestamptz;

-- ---------------------------------------------------------------------------
-- Ending a campaign (§11: lead data is deleted 30 days after a campaign ends).
-- ---------------------------------------------------------------------------
alter table public.campaigns add column purged_at timestamptz;
