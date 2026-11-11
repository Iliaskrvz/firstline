-- Phase 7: push personalised leads to sending tools (Instantly first), webhook events,
-- and outcome rows for the reply-rate loop (no personal data, kept after lead deletion).
-- All new tables are server only (RLS on, no policies): the app reads them through the
-- server's database connection after checking the user's workspace.

-- ---------------------------------------------------------------------------
-- Integrations: one per workspace and tool (table exists since Phase 1).
-- api_key_encrypted / webhook_secret hold AES-256-GCM ciphertext ("v1:..."), never plain text.
-- ---------------------------------------------------------------------------
alter table public.integrations
  add column status          text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  add column key_hint        text,                       -- last 4 characters, to recognise the key
  add column account_name    text,                       -- the tool's workspace name
  add column capabilities    jsonb not null default '{}'::jsonb,  -- {webhooks: bool, reason?: text}
  add column tool_webhook_ids text[] not null default '{}',
  add column last_checked_at timestamptz,
  add column last_error      text,
  add column last_polled_at  timestamptz,
  add column updated_at      timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Pushes: one dry run, full push or retry of a campaign into a tool campaign.
-- ---------------------------------------------------------------------------
create table public.pushes (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  campaign_id        uuid not null,
  integration_id     uuid not null references public.integrations (id) on delete cascade,
  provider           text not null,
  tool_campaign_id   text not null,
  tool_campaign_name text,
  variable_map       jsonb not null,           -- [{field, variable}]
  kind               text not null check (kind in ('dry_run', 'full')),
  status             text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  total              int not null default 0,
  added              int not null default 0,
  skipped            int not null default 0,
  failed             int not null default 0,
  error              text,
  lease_until        timestamptz,              -- the worker holding it; expired = resumable
  created_by         uuid,
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  foreign key (campaign_id, workspace_id) references public.campaigns (id, workspace_id) on delete cascade
);
create index pushes_campaign_idx on public.pushes (campaign_id, created_at desc);
create index pushes_open_idx on public.pushes (status) where status in ('queued', 'running');
alter table public.pushes enable row level security;

create table public.push_items (
  id               uuid primary key default gen_random_uuid(),
  push_id          uuid not null references public.pushes (id) on delete cascade,
  workspace_id     uuid not null,
  lead_id          uuid not null,
  integration_id   uuid not null references public.integrations (id) on delete cascade,
  tool_campaign_id text not null,
  email            text not null,             -- lower case; deleted with the lead (30-day rule)
  status           text not null default 'pending' check (status in ('pending', 'added', 'skipped', 'failed')),
  reason           text,
  tool_lead_id     text,
  attempts         int not null default 0,
  -- Status flags from the tool (no reply bodies).
  sent_at          timestamptz,
  replied_at       timestamptz,
  bounced_at       timestamptz,
  unsubscribed_at  timestamptz,
  updated_at       timestamptz not null default now(),
  foreign key (lead_id, workspace_id) references public.leads (id, workspace_id) on delete cascade
);
create index push_items_push_idx on public.push_items (push_id, status);
-- A lead is only ever added once to the same tool campaign.
create unique index push_items_added_once on public.push_items (integration_id, tool_campaign_id, email) where status = 'added';
create index push_items_match_idx on public.push_items (integration_id, tool_campaign_id, email);
alter table public.push_items enable row level security;

-- ---------------------------------------------------------------------------
-- Webhook / polling events, processed exactly once (dedupe_key is a hash: no email stored).
-- ---------------------------------------------------------------------------
create table public.integration_events (
  id             bigint generated always as identity primary key,
  integration_id uuid not null references public.integrations (id) on delete cascade,
  dedupe_key     text not null,
  event_type     text not null,
  source         text not null check (source in ('webhook', 'poll')),
  matched        boolean not null default false,
  received_at    timestamptz not null default now(),
  unique (integration_id, dedupe_key)
);
alter table public.integration_events enable row level security;

-- ---------------------------------------------------------------------------
-- Outcomes (V2 reply-rate loop groundwork): one row per email that left FirstLine.
-- No email, name or company: rows stay after the 30-day lead deletion (lead_id -> null).
-- ---------------------------------------------------------------------------
create table public.outcomes (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  campaign_id     uuid,
  lead_id         uuid references public.leads (id) on delete set null,
  step_no         int not null default 1,
  channel         text not null check (channel in ('gmail', 'csv', 'instantly', 'smartlead', 'lemlist', 'api')),
  skill_version   text,
  writer          text,
  personalised    boolean not null,           -- false = neutral fallback
  slot_types      text[] not null default '{}',
  fact_tiers      text[] not null default '{}',
  status          text not null check (status in ('exported', 'pushed', 'sent', 'replied', 'bounced', 'unsubscribed')),
  sent_at         timestamptz,
  replied_at      timestamptz,
  bounced_at      timestamptz,
  unsubscribed_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index outcomes_lead_channel_step on public.outcomes (lead_id, channel, step_no);
create index outcomes_version_idx on public.outcomes (skill_version, channel);
alter table public.outcomes enable row level security;

create or replace function public.outcome_rank(s text) returns int
language sql immutable as $$
  select case s when 'exported' then 0 when 'pushed' then 0 when 'sent' then 1 when 'replied' then 2
                when 'unsubscribed' then 3 when 'bounced' then 3 else 0 end
$$;

-- Record (or move forward) the outcome of one email per lead. Reads the features from the
-- lead's newest generation for that step; never copies personal data. Status never moves back.
create or replace function public.record_outcomes(p_leads uuid[], p_step int, p_channel text, p_status text, p_at timestamptz default now())
returns int
language plpgsql set search_path = '' as $$
declare n int;
begin
  insert into public.outcomes as o (workspace_id, campaign_id, lead_id, step_no, channel, skill_version, writer, personalised,
                                    slot_types, fact_tiers, status, sent_at, replied_at, bounced_at, unsubscribed_at)
  select l.workspace_id, l.campaign_id, l.id, p_step, p_channel, g.skill_version, c.writer, l.status = 'done',
         coalesce((select array_agg(k order by k) from jsonb_object_keys(coalesce(g.slot_outputs, '{}'::jsonb)) k), '{}'),
         coalesce((select array_agg(distinct f->>'tier' order by f->>'tier')
                     from jsonb_array_elements(coalesce(g.research->'facts', '[]'::jsonb)) f
                    where f->>'id' = any (g.facts_used) and f->>'tier' is not null), '{}'),
         p_status,
         case when p_status in ('sent', 'replied', 'bounced', 'unsubscribed') then p_at end,
         case when p_status = 'replied' then p_at end,
         case when p_status = 'bounced' then p_at end,
         case when p_status = 'unsubscribed' then p_at end
    from public.leads l
    join public.campaigns c on c.id = l.campaign_id
    left join lateral (
      select g.skill_version, g.slot_outputs, g.research, g.facts_used
        from public.generations g
       where g.lead_id = l.id and g.step_no = least(p_step, (select max(step_no) from public.generations where lead_id = l.id))
       order by g.created_at desc limit 1
    ) g on true
   where l.id = any (p_leads)
  on conflict (lead_id, channel, step_no) do update set
    status          = case when public.outcome_rank(excluded.status) > public.outcome_rank(o.status) then excluded.status else o.status end,
    sent_at         = coalesce(o.sent_at, excluded.sent_at),
    replied_at      = coalesce(o.replied_at, excluded.replied_at),
    bounced_at      = coalesce(o.bounced_at, excluded.bounced_at),
    unsubscribed_at = coalesce(o.unsubscribed_at, excluded.unsubscribed_at),
    updated_at      = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.record_outcomes(uuid[], int, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_outcomes(uuid[], int, text, text, timestamptz) to service_role;

-- Existing Gmail sends get their outcome rows (sent and later), so the reply-rate view starts with history.
do $$
declare r record;
begin
  for r in select lead_id, step_no, status, coalesce(replied_at, bounced_at, sent_at) at
             from public.sends where status in ('sent', 'replied', 'bounced') loop
    perform public.record_outcomes(array[r.lead_id], r.step_no, 'gmail', 'sent', r.at);
    if r.status <> 'sent' then
      perform public.record_outcomes(array[r.lead_id], r.step_no, 'gmail', r.status, r.at);
    end if;
  end loop;
end $$;
