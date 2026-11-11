-- Phase 9: public API for automation builders (n8n, Make): API keys, jobs, outbound webhooks.
-- Same credits and ledger as the app; API usage shows in the ledger as source 'api'.
-- All new tables are server only (RLS on, no policies).

-- ---------------------------------------------------------------------------
-- API keys: shown once, stored as a SHA-256 hash with a visible prefix (fl_live_ab12…).
-- ---------------------------------------------------------------------------
create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null,
  prefix       text not null,
  key_hash     text not null unique,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index api_keys_workspace_idx on public.api_keys (workspace_id, created_at desc);
alter table public.api_keys enable row level security;

-- Fixed one-minute windows per key (works across web processes).
create table public.api_rate_windows (
  api_key_id   uuid not null references public.api_keys (id) on delete cascade,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (api_key_id, window_start)
);
alter table public.api_rate_windows enable row level security;

-- ---------------------------------------------------------------------------
-- API campaigns: every API call becomes a hidden campaign, so the engine, credits and the 30-day
-- deletion work exactly as in the app. Hidden from the campaign list.
-- ---------------------------------------------------------------------------
alter table public.campaigns add column source text not null default 'app' check (source in ('app', 'api'));
create index campaigns_source_idx on public.campaigns (workspace_id, source);

create table public.api_jobs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  api_key_id      uuid references public.api_keys (id) on delete set null,
  campaign_id     uuid not null,
  kind            text not null check (kind in ('single', 'batch')),
  status          text not null default 'running' check (status in ('running', 'done')),
  lead_count      int not null,
  idempotency_key text,
  request_hash    text not null,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz,
  foreign key (campaign_id, workspace_id) references public.campaigns (id, workspace_id) on delete cascade
);
create unique index api_jobs_idempotency on public.api_jobs (api_key_id, idempotency_key) where idempotency_key is not null;
create index api_jobs_campaign_idx on public.api_jobs (campaign_id);
create index api_jobs_running_idx on public.api_jobs (status) where status = 'running';
alter table public.api_jobs enable row level security;

-- ---------------------------------------------------------------------------
-- Outbound webhooks (job.completed, batch.completed), HMAC-signed with a timestamp, retried.
-- Deliveries hold results (personal data): deleted after 30 days by the retention job.
-- ---------------------------------------------------------------------------
create table public.webhook_endpoints (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  url              text not null,
  secret_encrypted text not null,
  events           text[] not null default '{job.completed,batch.completed}',
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
create index webhook_endpoints_workspace_idx on public.webhook_endpoints (workspace_id);
alter table public.webhook_endpoints enable row level security;

create table public.webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  endpoint_id     uuid not null references public.webhook_endpoints (id) on delete cascade,
  workspace_id    uuid not null,
  event           text not null,
  event_id        text not null,                 -- e.g. the job id: one delivery per endpoint and event
  payload         jsonb not null,
  status          text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status     int,
  last_error      text,
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz,
  unique (endpoint_id, event, event_id)
);
create index webhook_deliveries_due_idx on public.webhook_deliveries (next_attempt_at) where status = 'pending';
alter table public.webhook_deliveries enable row level security;

-- ---------------------------------------------------------------------------
-- Ledger source: 'api' for credits moved for API campaigns, 'app' otherwise. Set on insert
-- (the ledger stays append-only: rows are never changed afterwards).
-- ---------------------------------------------------------------------------
alter table public.credit_ledger add column source text not null default 'app' check (source in ('app', 'api'));

create or replace function public.credit_ledger_set_source()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.campaigns c
     where c.source = 'api'
       and c.id = coalesce(new.campaign_id, (select l.campaign_id from public.leads l where l.id = new.lead_id))
  ) then
    new.source := 'api';
  end if;
  return new;
end $$;
create trigger credit_ledger_source before insert on public.credit_ledger
  for each row execute function public.credit_ledger_set_source();

-- Copy sent inline with an API call is stored as a hidden template.
alter table public.templates add column source text not null default 'app' check (source in ('app', 'api'));
