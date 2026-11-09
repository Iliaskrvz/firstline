-- Ledger hardening (agreed rules):
--   available = purchase + bonus + refund + release - reserve
--   reserved  = reserve - release - capture
--   spent     = capture
--   * One reserve per lead (unique), so a retried job can never reserve twice.
--   * Capture and release only against an existing reserve for the same lead.
--   * capture + release for a lead can never exceed its reserve.
--   * Reserve fails cleanly (returns false) when available < amount, under a
--     row lock on the workspace.
-- The rules are enforced in the table itself (constraint, unique index,
-- trigger), not only in the functions, so even buggy server code can't break them.

-- Reserve / capture / release must name a lead.
alter table public.credit_ledger
  add constraint credit_ledger_lead_required
  check (type not in ('reserve', 'capture', 'release') or lead_id is not null);

-- One reserve per lead, ever.
create unique index credit_ledger_one_reserve_per_lead
  on public.credit_ledger (lead_id) where type = 'reserve';

-- Capture/release must match an existing reserve and never exceed it.
create or replace function public.check_ledger_settlement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reserved int;
  v_reserve_ws uuid;
  v_settled int;
begin
  if new.type not in ('capture', 'release') then
    return new;
  end if;

  select -amount, workspace_id into v_reserved, v_reserve_ws
    from public.credit_ledger
   where lead_id = new.lead_id and type = 'reserve';

  if v_reserved is null then
    raise exception 'no reservation exists for lead %', new.lead_id
      using errcode = 'P0002';
  end if;
  if v_reserve_ws <> new.workspace_id then
    raise exception 'ledger row workspace does not match the reservation for lead %', new.lead_id;
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

create trigger credit_ledger_check_settlement
  before insert on public.credit_ledger
  for each row execute function public.check_ledger_settlement();

-- reserve: true if the lead now holds a reservation (new or from an earlier
-- attempt), false if there aren't enough credits. Never reserves twice.
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
  if p_amount is null or p_amount <= 0 then
    raise exception 'reserve amount must be positive';
  end if;

  select workspace_id, campaign_id into v_ws, v_campaign from public.leads where id = p_lead;
  if v_ws is null then
    raise exception 'lead % not found', p_lead using errcode = 'P0002';
  end if;

  -- Row lock: every ledger write for this workspace queues here.
  perform 1 from public.workspaces where id = v_ws for update;

  if exists (select 1 from public.credit_ledger where lead_id = p_lead and type = 'reserve') then
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

-- capture: takes up to p_amount of what is still open; returns what it took.
-- Raises if the lead was never reserved.
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
    raise exception 'lead % not found', p_lead using errcode = 'P0002';
  end if;

  perform 1 from public.workspaces where id = v_ws for update;

  if not exists (select 1 from public.credit_ledger where lead_id = p_lead and type = 'reserve') then
    raise exception 'no reservation exists for lead %', p_lead using errcode = 'P0002';
  end if;

  v_open := public.lead_open_reservation(p_lead);
  v_take := least(greatest(coalesce(p_amount, 0), 0), v_open);
  if v_take = 0 then
    return 0;
  end if;

  insert into public.credit_ledger (workspace_id, type, amount, campaign_id, lead_id, note)
  values (v_ws, 'capture', v_take, v_campaign, p_lead, 'capture');
  return v_take;
end;
$$;

-- release: returns whatever is still open; returns what it released.
-- Raises if the lead was never reserved.
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
    raise exception 'lead % not found', p_lead using errcode = 'P0002';
  end if;

  perform 1 from public.workspaces where id = v_ws for update;

  if not exists (select 1 from public.credit_ledger where lead_id = p_lead and type = 'reserve') then
    raise exception 'no reservation exists for lead %', p_lead using errcode = 'P0002';
  end if;

  v_open := public.lead_open_reservation(p_lead);
  if v_open <= 0 then
    return 0;
  end if;

  insert into public.credit_ledger (workspace_id, type, amount, campaign_id, lead_id, note)
  values (v_ws, 'release', v_open, v_campaign, p_lead, 'release');
  return v_open;
end;
$$;

-- Cancel: release only leads that actually hold a reservation.
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
  for r in
    select distinct l.lead_id
      from public.credit_ledger l
     where l.campaign_id = p_campaign and l.type = 'reserve'
  loop
    v_total := v_total + public.release_credits(r.lead_id);
  end loop;
  return v_total;
end;
$$;

-- Re-assert: credit functions are server-only.
revoke all on function public.reserve_credits(uuid, int) from public, anon, authenticated;
revoke all on function public.capture_credits(uuid, int) from public, anon, authenticated;
revoke all on function public.release_credits(uuid) from public, anon, authenticated;
revoke all on function public.release_campaign_credits(uuid) from public, anon, authenticated;
revoke all on function public.check_ledger_settlement() from public, anon, authenticated;
grant execute on function public.reserve_credits(uuid, int) to service_role;
grant execute on function public.capture_credits(uuid, int) to service_role;
grant execute on function public.release_credits(uuid) to service_role;
grant execute on function public.release_campaign_credits(uuid) to service_role;
