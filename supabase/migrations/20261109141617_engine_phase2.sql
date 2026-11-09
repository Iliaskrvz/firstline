-- Phase 2: engine support.

-- Why a lead ended where it did ("Website unreachable", "Anthropic key missing", ...).
alter table public.leads add column status_detail text;
-- Position in the free 5-lead preview (null = not in the preview).
alter table public.leads add column preview_rank smallint check (preview_rank between 1 and 5);
create index leads_preview_idx on public.leads (campaign_id, preview_rank) where preview_rank is not null;

-- What the preview screen needs, readable by the workspace (domain_research is
-- global and server-only, so each generation keeps a snapshot of its research).
alter table public.generations
  add column research jsonb not null default '{}'::jsonb,   -- {pages:[{url,type}], facts:[...], status}
  add column provider text not null default 'anthropic',    -- 'fake' = test output, no AI used
  add column is_preview boolean not null default false,
  add column attempts smallint not null default 1;

-- Cached facts are only reused by the same extractor, so fake test facts are
-- never served once the real model is switched on.
alter table public.domain_research
  add column extractor text not null default 'unknown',
  add column status text not null default 'ok';            -- ok | unreachable | blocked | no_content

-- Worker heartbeat (global, server-only). The app reads it via worker_status().
create table public.worker_heartbeats (
  worker_id    text primary key,
  host         text,
  version      text,
  llm_provider text,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  jobs_done    int not null default 0,
  jobs_failed  int not null default 0
);
alter table public.worker_heartbeats enable row level security;

create or replace function public.worker_status()
returns table (last_seen_at timestamptz, seconds_ago int, workers int, llm_provider text)
language sql
stable
security definer
set search_path = ''
as $$
  select max(h.last_seen_at),
         extract(epoch from now() - max(h.last_seen_at))::int,
         count(*)::int,
         max(h.llm_provider)
    from public.worker_heartbeats h
   where h.last_seen_at > now() - interval '1 hour';
$$;
revoke all on function public.worker_status() from public, anon;
grant execute on function public.worker_status() to authenticated, service_role;
