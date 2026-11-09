-- FirstLine — initial schema (SPEC.md §3)
--
-- Deviations from the spec, agreed/flagged in Phase 1:
--   * generations, usage_costs, sequence_steps and sends also carry workspace_id
--     so RLS can be applied uniformly ("every table has workspace_id").
--   * Child rows use composite FKs (x_id, workspace_id) so a row can never point
--     at another workspace's parent.
--   * Global tables (domain_research, skill_versions, eval_runs, example_library)
--     have RLS enabled with NO policies: only the service role (worker) can use them.
--   * Ledger sign convention (see workspace_balance below).


-- ---------------------------------------------------------------------------
-- Workspaces
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  owner_id           uuid not null references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  auto_topup         jsonb,
  created_at         timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- Membership check used by every RLS policy. SECURITY DEFINER so it can read
-- workspace_members without recursing into that table's own policies.
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_workspace_owner(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_workspace_owner(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.is_workspace_owner(uuid) to authenticated, service_role;

-- Create a workspace (and owner membership) for every new user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_id uuid;
  display_name text;
begin
  display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, 'My'), '@', 1)
  );

  insert into public.workspaces (name, owner_id)
  values (display_name || '''s workspace', new.id)
  returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Templates & campaigns
-- ---------------------------------------------------------------------------

create table public.templates (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null,
  subject      text not null default '',
  body         text not null default '',
  slots        jsonb not null default '[]'::jsonb,   -- [{key, instruction, max_words}]
  style_rules  jsonb not null default '{}'::jsonb,   -- {language, tone, banned_phrases[], extra_rules[]}
  examples     jsonb not null default '[]'::jsonb,   -- preview feedback used as few-shot
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, workspace_id)
);
create index templates_workspace_idx on public.templates (workspace_id);

create table public.campaigns (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  template_id  uuid,
  name         text not null,
  status       text not null default 'draft'
               check (status in ('draft', 'preview', 'running', 'done', 'cancelled')),
  mode         text not null default 'now' check (mode in ('now', 'economy')),
  depth        jsonb not null default '{"deep": false, "local": false}'::jsonb,
  writer       text not null default 'pro' check (writer in ('pro', 'lite')),
  column_map   jsonb not null default '{}'::jsonb,
  counts       jsonb not null default '{}'::jsonb,
  holdout_pct  int not null default 0 check (holdout_pct between 0 and 100),
  ended_at     timestamptz,
  created_at   timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (template_id, workspace_id)
    references public.templates (id, workspace_id) on delete set null (template_id)
);
create index campaigns_workspace_idx on public.campaigns (workspace_id, created_at desc);

create table public.leads (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null,
  workspace_id      uuid not null,
  email             text not null,
  first_name        text,
  last_name         text,
  company           text,
  title             text,                 -- from CSV only
  linkedin_headline text,                 -- from CSV only
  website           text,
  domain            text,                 -- normalised
  custom            jsonb not null default '{}'::jsonb,
  status            text not null default 'queued'
                    check (status in ('queued', 'researching', 'writing', 'done', 'fallback', 'failed', 'skipped')),
  confidence        text check (confidence in ('high', 'medium', 'low')),
  is_holdout        boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (id, workspace_id),
  unique (campaign_id, email),
  foreign key (campaign_id, workspace_id)
    references public.campaigns (id, workspace_id) on delete cascade
);
create index leads_campaign_idx on public.leads (campaign_id, status);
create index leads_workspace_idx on public.leads (workspace_id);
create index leads_domain_idx on public.leads (domain);

-- ---------------------------------------------------------------------------
-- Research cache (global, service role only)
-- ---------------------------------------------------------------------------

create table public.domain_research (
  domain        text primary key,
  pages         jsonb not null default '[]'::jsonb,   -- [{url, type, md_hash}]
  facts         jsonb not null default '[]'::jsonb,   -- [{id, text, src, tier}]
  place_id      text,                                 -- only Google field we may store
  researched_at timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '30 days')
);

-- ---------------------------------------------------------------------------
-- Generations & costs
-- ---------------------------------------------------------------------------

create table public.generations (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null,
  workspace_id   uuid not null,
  plan           jsonb,                    -- {angle, pain, move[], cta_type}
  slot_outputs   jsonb not null default '{}'::jsonb,
  full_email     text,
  subject        text,
  facts_used     text[] not null default '{}',
  skill_version  text,
  checks         jsonb not null default '{}'::jsonb,
  judge_scores   jsonb not null default '{}'::jsonb,
  edited_by_user boolean not null default false,
  created_at     timestamptz not null default now(),
  foreign key (lead_id, workspace_id) references public.leads (id, workspace_id) on delete cascade
);
create index generations_lead_idx on public.generations (lead_id, created_at desc);

create table public.usage_costs (
  id             bigint generated always as identity primary key,
  lead_id        uuid,
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  step           text not null
                 check (step in ('scrape', 'extract', 'write', 'validate', 'judge', 'search', 'places')),
  model          text,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  cached_tokens  int not null default 0,
  provider_units numeric not null default 0,
  cost_usd       numeric(12, 6) not null default 0,
  created_at     timestamptz not null default now(),
  foreign key (lead_id, workspace_id) references public.leads (id, workspace_id) on delete set null (lead_id)
);
create index usage_costs_workspace_idx on public.usage_costs (workspace_id, created_at desc);
create index usage_costs_lead_idx on public.usage_costs (lead_id);

-- ---------------------------------------------------------------------------
-- Quality (global, service role only)
-- ---------------------------------------------------------------------------

create table public.example_library (
  id               bigint generated always as identity primary key,
  industry         text,
  language         text,
  angle            text,
  email_text       text not null,
  sends            int not null default 0,
  positive_replies int not null default 0,
  label            text check (label in ('winner', 'loser')),
  source           text not null default 'own' check (source in ('own', 'customer_opt_in')),
  created_at       timestamptz not null default now()
);

create table public.skill_versions (
  version       text primary key,
  prompt        text not null,
  rules         jsonb not null default '{}'::jsonb,
  moves         jsonb not null default '[]'::jsonb,
  example_ids   bigint[] not null default '{}',
  status        text not null default 'draft' check (status in ('draft', 'testing', 'live', 'retired')),
  traffic_share int not null default 0 check (traffic_share between 0 and 100),
  changelog     text,
  created_at    timestamptz not null default now()
);

create table public.eval_runs (
  id               bigint generated always as identity primary key,
  skill_version    text not null references public.skill_versions (version),
  baseline_version text references public.skill_versions (version),
  test_set_id      text not null,
  wins             int not null default 0,
  losses           int not null default 0,
  ties             int not null default 0,
  judge_avg        numeric(4, 2),
  rule_fail_rate   numeric(5, 4),
  human_picks      jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------

create table public.inboxes (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  email             text not null,
  type              text not null default 'gmail_script' check (type in ('gmail_script', 'gmail_oauth')),
  sender_key_hash   text unique,
  daily_cap         int not null default 30 check (daily_cap > 0),
  warmup_day        int not null default 0,
  "window"          jsonb not null default
                    '{"days": [1, 2, 3, 4, 5], "start": "08:30", "end": "17:00", "tz": "Europe/Amsterdam"}'::jsonb,
  health            text not null default 'warming' check (health in ('healthy', 'warming', 'offline', 'paused')),
  last_heartbeat_at timestamptz,
  created_at        timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, email)
);

create table public.sequence_steps (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null,
  workspace_id   uuid not null,
  step_no        int not null check (step_no >= 1),
  delay_days     int not null default 0 check (delay_days >= 0),  -- working days
  kind           text not null default 'plain' check (kind in ('personalised', 'plain')),
  template_body  text not null default '',
  same_thread    boolean not null default true,
  unique (campaign_id, step_no),
  foreign key (campaign_id, workspace_id) references public.campaigns (id, workspace_id) on delete cascade
);

create table public.sends (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null,
  workspace_id    uuid not null,
  step_no         int not null default 1,
  inbox_id        uuid,
  scheduled_for   timestamptz,
  status          text not null default 'queued'
                  check (status in ('queued', 'sent', 'replied', 'bounced', 'stopped')),
  gmail_thread_id text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (lead_id, step_no),
  foreign key (lead_id, workspace_id) references public.leads (id, workspace_id) on delete cascade,
  foreign key (inbox_id, workspace_id) references public.inboxes (id, workspace_id) on delete set null (inbox_id)
);
create index sends_inbox_status_idx on public.sends (inbox_id, status, scheduled_for);

create table public.integrations (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  provider          text not null check (provider in ('instantly', 'smartlead', 'lemlist')),
  api_key_encrypted text,
  webhook_secret    text,
  auto_rules        jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table public.suppression (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email        text,
  domain       text,
  reason       text not null check (reason in ('unsub', 'bounce', 'replied', 'manual')),
  created_at   timestamptz not null default now(),
  check (email is not null or domain is not null)
);
create unique index suppression_unique_idx
  on public.suppression (workspace_id, coalesce(email, ''), coalesce(domain, ''));

-- ---------------------------------------------------------------------------
-- Credit ledger (append-only)
-- ---------------------------------------------------------------------------
-- Sign convention:
--   purchase, bonus, refund, release : amount > 0   (adds to available)
--   reserve                          : amount < 0   (moves available -> reserved)
--   capture                          : amount > 0   (moves reserved -> spent; does
--                                                    NOT touch available)
-- So:
--   available = sum(amount) over every type except capture
--   reserved  = -(reserve) - release - capture
--   spent     = capture

create table public.credit_ledger (
  id              bigint generated always as identity primary key,
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  type            text not null check (type in ('purchase', 'bonus', 'reserve', 'capture', 'release', 'refund')),
  amount          int not null,
  -- No FKs on campaign_id/lead_id on purpose: the ledger is permanent history
  -- and must survive the 30-day lead auto-delete (§11).
  campaign_id     uuid,
  lead_id         uuid,
  stripe_event_id text unique,
  note            text,
  created_at      timestamptz not null default now(),
  check (
    (type = 'reserve' and amount < 0)
    or (type <> 'reserve' and amount > 0)
  )
);
create index credit_ledger_workspace_idx on public.credit_ledger (workspace_id, created_at desc);
create index credit_ledger_lead_idx on public.credit_ledger (lead_id) where lead_id is not null;

create or replace function public.forbid_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'credit_ledger is append-only';
end;
$$;

-- Rows can never be changed. Deletes are only possible for the service role
-- (workspace/account deletion cascades); users can't delete anything.
create trigger credit_ledger_no_update
  before update on public.credit_ledger
  for each row execute function public.forbid_ledger_mutation();
revoke insert, update, delete, truncate on public.credit_ledger from anon, authenticated;

create view public.workspace_balance
with (security_invoker = true)
as
select
  w.id as workspace_id,
  coalesce(sum(l.amount) filter (where l.type <> 'capture'), 0)::int as available,
  (
    coalesce(-sum(l.amount) filter (where l.type = 'reserve'), 0)
    - coalesce(sum(l.amount) filter (where l.type in ('release', 'capture')), 0)
  )::int as reserved,
  coalesce(sum(l.amount) filter (where l.type = 'capture'), 0)::int as spent
from public.workspaces w
left join public.credit_ledger l on l.workspace_id = w.id
group by w.id;

-- Open (still reserved) credits for one lead.
create or replace function public.lead_open_reservation(p_lead uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce(
    -sum(amount) filter (where type = 'reserve')
    - coalesce(sum(amount) filter (where type in ('release', 'capture')), 0),
    0
  )::int
  from public.credit_ledger
  where lead_id = p_lead;
$$;

-- Reserve p_amount credits for a lead. Idempotent: a lead that already holds an
-- open reservation is not reserved again. Returns false if not enough credits.
create or replace function public.reserve_credits(p_lead uuid, p_amount int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_campaign uuid;
  v_available int;
begin
  if p_amount <= 0 then
    raise exception 'reserve amount must be positive';
  end if;

  select workspace_id, campaign_id into v_ws, v_campaign from public.leads where id = p_lead;
  if v_ws is null then
    raise exception 'lead % not found', p_lead;
  end if;

  -- Serialise all ledger writes for this workspace.
  perform 1 from public.workspaces where id = v_ws for update;

  if public.lead_open_reservation(p_lead) > 0 then
    return true;
  end if;

  select coalesce(sum(amount) filter (where type <> 'capture'), 0)
    into v_available
    from public.credit_ledger where workspace_id = v_ws;

  if v_available < p_amount then
    return false;
  end if;

  insert into public.credit_ledger (workspace_id, type, amount, campaign_id, lead_id, note)
  values (v_ws, 'reserve', -p_amount, v_campaign, p_lead, 'reserve');
  return true;
end;
$$;

-- Capture up to p_amount of a lead's open reservation (success). Idempotent:
-- never captures more than is still reserved. Returns the amount captured.
create or replace function public.capture_credits(p_lead uuid, p_amount int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_campaign uuid;
  v_open int;
  v_take int;
begin
  select workspace_id, campaign_id into v_ws, v_campaign from public.leads where id = p_lead;
  if v_ws is null then
    raise exception 'lead % not found', p_lead;
  end if;

  perform 1 from public.workspaces where id = v_ws for update;

  v_open := public.lead_open_reservation(p_lead);
  v_take := least(greatest(p_amount, 0), v_open);
  if v_take = 0 then
    return 0;
  end if;

  insert into public.credit_ledger (workspace_id, type, amount, campaign_id, lead_id, note)
  values (v_ws, 'capture', v_take, v_campaign, p_lead, 'capture');
  return v_take;
end;
$$;

-- Release whatever is still reserved for a lead (fallback / cancel / partial
-- add-on failure). Idempotent. Returns the amount released.
create or replace function public.release_credits(p_lead uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_campaign uuid;
  v_open int;
begin
  select workspace_id, campaign_id into v_ws, v_campaign from public.leads where id = p_lead;
  if v_ws is null then
    raise exception 'lead % not found', p_lead;
  end if;

  perform 1 from public.workspaces where id = v_ws for update;

  v_open := public.lead_open_reservation(p_lead);
  if v_open <= 0 then
    return 0;
  end if;

  insert into public.credit_ledger (workspace_id, type, amount, campaign_id, lead_id, note)
  values (v_ws, 'release', v_open, v_campaign, p_lead, 'release');
  return v_open;
end;
$$;

-- Release every open reservation in a campaign (cancel).
create or replace function public.release_campaign_credits(p_campaign uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total int := 0;
  r record;
begin
  for r in select id from public.leads where campaign_id = p_campaign loop
    v_total := v_total + public.release_credits(r.id);
  end loop;
  return v_total;
end;
$$;

-- Stripe webhook -> purchase. Idempotent on stripe_event_id.
create or replace function public.add_purchase(
  p_workspace uuid, p_amount int, p_stripe_event_id text, p_note text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows int;
begin
  insert into public.credit_ledger (workspace_id, type, amount, stripe_event_id, note)
  values (p_workspace, 'purchase', p_amount, p_stripe_event_id, p_note)
  on conflict (stripe_event_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- Money/credit functions are for the server (service role) only. Users must
-- never be able to grant themselves credits.
revoke all on function public.lead_open_reservation(uuid) from public, anon, authenticated;
revoke all on function public.reserve_credits(uuid, int) from public, anon, authenticated;
revoke all on function public.capture_credits(uuid, int) from public, anon, authenticated;
revoke all on function public.release_credits(uuid) from public, anon, authenticated;
revoke all on function public.release_campaign_credits(uuid) from public, anon, authenticated;
revoke all on function public.add_purchase(uuid, int, text, text) from public, anon, authenticated;
grant execute on function public.lead_open_reservation(uuid) to service_role;
grant execute on function public.reserve_credits(uuid, int) to service_role;
grant execute on function public.capture_credits(uuid, int) to service_role;
grant execute on function public.release_credits(uuid) to service_role;
grant execute on function public.release_campaign_credits(uuid) to service_role;
grant execute on function public.add_purchase(uuid, int, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.templates         enable row level security;
alter table public.campaigns         enable row level security;
alter table public.leads             enable row level security;
alter table public.domain_research   enable row level security;
alter table public.generations       enable row level security;
alter table public.usage_costs       enable row level security;
alter table public.example_library   enable row level security;
alter table public.skill_versions    enable row level security;
alter table public.eval_runs         enable row level security;
alter table public.inboxes           enable row level security;
alter table public.sequence_steps    enable row level security;
alter table public.sends             enable row level security;
alter table public.integrations      enable row level security;
alter table public.suppression       enable row level security;
alter table public.credit_ledger     enable row level security;

-- workspaces: members read, owner renames. Creation happens via trigger only.
create policy "members read workspace" on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));
create policy "owner updates workspace" on public.workspaces
  for update to authenticated using (public.is_workspace_owner(id)) with check (public.is_workspace_owner(id));
-- Billing fields are server-managed.
revoke update on public.workspaces from authenticated;
grant update (name) on public.workspaces to authenticated;

-- workspace_members: members see their workspace's members; owner manages.
create policy "members read members" on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "owner manages members" on public.workspace_members
  for all to authenticated
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

-- Fully member-editable workspace tables.
create policy "members all templates" on public.templates
  for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members all campaigns" on public.campaigns
  for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members all leads" on public.leads
  for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members all sequence_steps" on public.sequence_steps
  for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members all suppression" on public.suppression
  for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members all inboxes" on public.inboxes
  for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members all integrations" on public.integrations
  for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

-- Generations: read + edit (user edits), written by the worker.
create policy "members read generations" on public.generations
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members edit generations" on public.generations
  for update to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

-- Read-only for members; written by the server.
create policy "members read sends" on public.sends
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members read usage_costs" on public.usage_costs
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members read ledger" on public.credit_ledger
  for select to authenticated using (public.is_workspace_member(workspace_id));

-- Inbox sender keys and integration secrets never go to the browser.
-- (A column revoke is ignored while a table-level grant exists, so revoke the
-- table and grant the safe columns back.)
revoke select, insert, update on public.inboxes from anon, authenticated;
grant select (id, workspace_id, email, type, daily_cap, warmup_day, "window", health, last_heartbeat_at, created_at)
  on public.inboxes to authenticated;
grant insert (workspace_id, email, daily_cap, "window") on public.inboxes to authenticated;
grant update (email, daily_cap, "window", health) on public.inboxes to authenticated;

revoke select, insert, update on public.integrations from anon, authenticated;
grant select (id, workspace_id, provider, auto_rules, created_at) on public.integrations to authenticated;
grant update (auto_rules) on public.integrations to authenticated;

-- domain_research, example_library, skill_versions, eval_runs: no policies
-- => service role only.

-- Keep templates.updated_at fresh.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger templates_touch before update on public.templates
  for each row execute function public.touch_updated_at();
