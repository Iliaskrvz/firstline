-- Phase 10: teams (owner / admin / member, invites, activity log), concurrency per workspace,
-- limits per provider shared by all workers, and Lite credits (cheaper, only for Lite runs).

-- ---------------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------------
alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check check (role in ('owner', 'admin', 'member'));

-- Owners and admins: buy credits, manage integrations, API keys and the team.
create or replace function public.is_workspace_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  );
$$;
revoke all on function public.is_workspace_admin(uuid) from public, anon;
grant execute on function public.is_workspace_admin(uuid) to authenticated, service_role;

-- Integrations: every member may see that one is connected; only owners and admins change it.
drop policy "members all integrations" on public.integrations;
create policy "members read integrations" on public.integrations for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "admins manage integrations" on public.integrations for all to authenticated
  using (public.is_workspace_admin(workspace_id)) with check (public.is_workspace_admin(workspace_id));

-- Invites: a link with a one-time token (stored hashed), valid 7 days. Server only.
create table public.workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email        text not null,
  role         text not null check (role in ('admin', 'member')),
  token_hash   text not null unique,
  invited_by   uuid,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid,
  revoked_at   timestamptz
);
create unique index workspace_invites_open on public.workspace_invites (workspace_id, lower(email)) where accepted_at is null and revoked_at is null;
alter table public.workspace_invites enable row level security;

-- Activity log: who ran, pushed, bought or changed what. Members read their workspace's log.
create table public.activity_log (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid,
  actor        text not null,          -- email at the time, or 'FirstLine' / 'API key …' for automatic events
  action       text not null,          -- e.g. campaign.run, push.start, credits.bought, member.invited
  target       text,                   -- human-readable: campaign name, email, key name
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index activity_log_workspace_idx on public.activity_log (workspace_id, created_at desc);
alter table public.activity_log enable row level security;
create policy "members read activity" on public.activity_log for select to authenticated using (public.is_workspace_member(workspace_id));
revoke insert, update, delete on public.activity_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Concurrency: leads running at once per workspace. Null = the level from credits bought.
-- ---------------------------------------------------------------------------
alter table public.workspaces add column concurrency_limit int check (concurrency_limit between 1 and 200);

-- One row per lead being processed; rows past expires_at belong to a crashed worker and don't count.
create table public.workspace_slots (
  lead_id      uuid primary key,
  workspace_id uuid not null,
  worker_id    text not null,
  expires_at   timestamptz not null
);
create index workspace_slots_ws_idx on public.workspace_slots (workspace_id, expires_at);
alter table public.workspace_slots enable row level security;

-- Provider limits shared by every worker process (Firecrawl concurrency, Anthropic per minute).
create table public.provider_slots (
  provider   text not null,
  slot       int not null,
  holder     text,
  expires_at timestamptz,
  primary key (provider, slot)
);
alter table public.provider_slots enable row level security;

create table public.provider_windows (
  provider     text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (provider, window_start)
);
alter table public.provider_windows enable row level security;

-- ---------------------------------------------------------------------------
-- Lite credits: bought in Lite packs, cheaper, usable only for Lite-writer runs.
-- A lead's capture and release always use the kind of its reserve.
-- ---------------------------------------------------------------------------
alter table public.credit_ledger add column kind text not null default 'standard' check (kind in ('standard', 'lite'));

create or replace function public.check_ledger_settlement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reserved int;
  v_reserve_ws uuid;
  v_reserve_kind text;
  v_settled int;
begin
  if new.type not in ('capture', 'release') then
    return new;
  end if;

  select -amount, workspace_id, kind into v_reserved, v_reserve_ws, v_reserve_kind
    from public.credit_ledger
   where lead_id = new.lead_id and type = 'reserve';

  if v_reserved is null then
    raise exception 'no reservation exists for lead %', new.lead_id using errcode = 'P0002';
  end if;
  if v_reserve_ws <> new.workspace_id then
    raise exception 'ledger row workspace does not match the reservation for lead %', new.lead_id;
  end if;
  if v_reserve_kind <> new.kind then
    raise exception 'ledger row kind (%) does not match the reservation (%) for lead %', new.kind, v_reserve_kind, new.lead_id;
  end if;

  select coalesce(sum(amount), 0) into v_settled
    from public.credit_ledger
   where lead_id = new.lead_id and type in ('capture', 'release');

  if v_settled + new.amount > v_reserved then
    raise exception 'capture + release (%) would exceed the reservation (%) for lead %',
      v_settled + new.amount, v_reserved, new.lead_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Lite runs use Lite credits first, then standard ones. Pro runs only standard credits.
create or replace function public.reserve_credits(p_lead uuid, p_amount int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_campaign uuid;
  v_writer text;
  v_standard int;
  v_lite int;
  v_kind text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'reserve amount must be positive';
  end if;

  select l.workspace_id, l.campaign_id, c.writer into v_ws, v_campaign, v_writer
    from public.leads l join public.campaigns c on c.id = l.campaign_id where l.id = p_lead;
  if v_ws is null then
    raise exception 'lead % not found', p_lead using errcode = 'P0002';
  end if;

  perform 1 from public.workspaces where id = v_ws for update;

  if exists (select 1 from public.credit_ledger where lead_id = p_lead and type = 'reserve') then
    return true;
  end if;

  select coalesce(sum(amount) filter (where type <> 'capture' and kind = 'standard'), 0),
         coalesce(sum(amount) filter (where type <> 'capture' and kind = 'lite'), 0)
    into v_standard, v_lite
    from public.credit_ledger where workspace_id = v_ws;

  if v_writer = 'lite' and v_lite >= p_amount then
    v_kind := 'lite';
  elsif v_standard >= p_amount then
    v_kind := 'standard';
  else
    return false;
  end if;

  insert into public.credit_ledger (workspace_id, type, amount, campaign_id, lead_id, note, kind)
  values (v_ws, 'reserve', -p_amount, v_campaign, p_lead, 'reserve', v_kind);
  return true;
end;
$$;

create or replace function public.capture_credits(p_lead uuid, p_amount int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_campaign uuid;
  v_kind text;
  v_open int;
  v_take int;
begin
  select workspace_id, campaign_id into v_ws, v_campaign from public.leads where id = p_lead;
  if v_ws is null then
    raise exception 'lead % not found', p_lead using errcode = 'P0002';
  end if;
  perform 1 from public.workspaces where id = v_ws for update;
  select kind into v_kind from public.credit_ledger where lead_id = p_lead and type = 'reserve';
  if v_kind is null then
    raise exception 'no reservation exists for lead %', p_lead using errcode = 'P0002';
  end if;
  v_open := public.lead_open_reservation(p_lead);
  v_take := least(greatest(coalesce(p_amount, 0), 0), v_open);
  if v_take = 0 then
    return 0;
  end if;
  insert into public.credit_ledger (workspace_id, type, amount, campaign_id, lead_id, note, kind)
  values (v_ws, 'capture', v_take, v_campaign, p_lead, 'capture', v_kind);
  return v_take;
end;
$$;

create or replace function public.release_credits(p_lead uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_campaign uuid;
  v_kind text;
  v_open int;
begin
  select workspace_id, campaign_id into v_ws, v_campaign from public.leads where id = p_lead;
  if v_ws is null then
    raise exception 'lead % not found', p_lead using errcode = 'P0002';
  end if;
  perform 1 from public.workspaces where id = v_ws for update;
  select kind into v_kind from public.credit_ledger where lead_id = p_lead and type = 'reserve';
  if v_kind is null then
    raise exception 'no reservation exists for lead %', p_lead using errcode = 'P0002';
  end if;
  v_open := public.lead_open_reservation(p_lead);
  if v_open <= 0 then
    return 0;
  end if;
  insert into public.credit_ledger (workspace_id, type, amount, campaign_id, lead_id, note, kind)
  values (v_ws, 'release', v_open, v_campaign, p_lead, 'release', v_kind);
  return v_open;
end;
$$;

-- Purchases name their kind (Lite packs → 'lite'). The old 4-argument form stays for standard packs.
create or replace function public.add_purchase(p_workspace uuid, p_amount int, p_event_id text, p_note text, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  if p_kind not in ('standard', 'lite') then
    raise exception 'unknown credit kind %', p_kind;
  end if;
  insert into public.credit_ledger (workspace_id, type, amount, stripe_event_id, note, kind)
  values (p_workspace, 'purchase', p_amount, p_event_id, p_note, p_kind)
  on conflict (stripe_event_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;
revoke all on function public.add_purchase(uuid, int, text, text, text) from public, anon, authenticated;
grant execute on function public.add_purchase(uuid, int, text, text, text) to service_role;
revoke all on function public.reserve_credits(uuid, int) from public, anon, authenticated;
revoke all on function public.capture_credits(uuid, int) from public, anon, authenticated;
revoke all on function public.release_credits(uuid) from public, anon, authenticated;
grant execute on function public.reserve_credits(uuid, int) to service_role;
grant execute on function public.capture_credits(uuid, int) to service_role;
grant execute on function public.release_credits(uuid) to service_role;

-- available = standard credits (any run); lite_available = Lite credits (Lite runs only).
create or replace view public.workspace_balance
with (security_invoker = true)
as
select
  w.id as workspace_id,
  coalesce(sum(l.amount) filter (where l.type <> 'capture' and l.kind = 'standard'), 0)::int as available,
  (
    coalesce(-sum(l.amount) filter (where l.type = 'reserve'), 0)
    - coalesce(sum(l.amount) filter (where l.type in ('release', 'capture')), 0)
  )::int as reserved,
  coalesce(sum(l.amount) filter (where l.type = 'capture'), 0)::int as spent,
  coalesce(sum(l.amount) filter (where l.type <> 'capture' and l.kind = 'lite'), 0)::int as lite_available,
  coalesce(sum(l.amount) filter (where l.type = 'purchase'), 0)::int as purchased
from public.workspaces w
left join public.credit_ledger l on l.workspace_id = w.id
group by w.id;

-- ---------------------------------------------------------------------------
-- Fair sharing of the provider limits (owner's change request, 2026-11-12): when the shared
-- Firecrawl / Anthropic limits are full, waiting calls are let in by priority (free previews first),
-- then the workspace using the fewest slots, then first come. Waiters refresh their row while
-- they wait, so a crashed worker's waiters disappear.
-- ---------------------------------------------------------------------------
alter table public.provider_slots add column holder_ws text;

create table public.provider_waiters (
  id           uuid primary key,
  provider     text not null,
  workspace_id text not null,
  priority     int not null default 0,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index provider_waiters_provider_idx on public.provider_waiters (provider, expires_at);
alter table public.provider_waiters enable row level security;

-- Calls per workspace in the current minute (fair share of a requests-per-minute limit).
create table public.provider_window_usage (
  provider     text not null,
  window_start timestamptz not null,
  workspace_id text not null,
  count        int not null default 0,
  primary key (provider, window_start, workspace_id)
);
alter table public.provider_window_usage enable row level security;

-- Workspaces that want worker capacity right now (running or waiting), for the fair share of workers.
create table public.workspace_demand (
  workspace_id    uuid primary key,
  last_wanted_at  timestamptz not null default now()
);
alter table public.workspace_demand enable row level security;

-- ---------------------------------------------------------------------------
-- Provider budgets (free Firecrawl plan: 1,000 credits a month; Anthropic monthly spend cap):
-- one alert per provider, month and level.
-- ---------------------------------------------------------------------------
create table public.provider_budget_alerts (
  provider text not null,
  period   text not null,          -- e.g. 2026-11
  level    int not null,           -- percent: 80, 100
  sent_at  timestamptz not null default now(),
  primary key (provider, period, level)
);
alter table public.provider_budget_alerts enable row level security;
