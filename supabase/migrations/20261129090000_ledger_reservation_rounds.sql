-- Security fix (review 2026-11-26, S1): a lead could hold only one reservation ever. After its credits
-- were released (run stopped, fit check skipped it, failed for good), running it again reserved
-- nothing and the email was written for 0 credits. Now a lead can take a new reservation once the
-- previous one was fully released (never once it was charged): each reservation is a "round", at most
-- one is open at a time, and
-- capture/release always settle the open round. A retried job still can't reserve twice (an open
-- reservation is reused, as before).

alter table public.credit_ledger add column round int not null default 1 check (round >= 1);

drop index if exists public.credit_ledger_one_reserve_per_lead;
create unique index credit_ledger_one_reserve_per_lead_round
  on public.credit_ledger (lead_id, round) where type = 'reserve';

-- The open round of a lead: its latest reservation (null when it never had one).
create or replace function public.lead_reserve_round(p_lead uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select max(round) from public.credit_ledger where lead_id = p_lead and type = 'reserve';
$$;

-- Capture/release must match the reservation of their round and never exceed it.
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
   where lead_id = new.lead_id and type = 'reserve' and round = new.round;

  if v_reserved is null then
    raise exception 'no reservation exists for lead % (round %)', new.lead_id, new.round using errcode = 'P0002';
  end if;
  if v_reserve_ws <> new.workspace_id then
    raise exception 'ledger row workspace does not match the reservation for lead %', new.lead_id;
  end if;
  if v_reserve_kind <> new.kind then
    raise exception 'ledger row kind (%) does not match the reservation (%) for lead %', new.kind, v_reserve_kind, new.lead_id;
  end if;

  select coalesce(sum(amount), 0) into v_settled
    from public.credit_ledger
   where lead_id = new.lead_id and round = new.round and type in ('capture', 'release');

  if v_settled + new.amount > v_reserved then
    raise exception 'capture + release (%) would exceed the reservation (%) for lead %',
      v_settled + new.amount, v_reserved, new.lead_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- reserve: true if the lead now holds an open reservation (new, or still open from an earlier
-- attempt), false if there aren't enough credits. Lite runs use Lite credits first.
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
  v_round int;
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

  -- Still open from an earlier attempt: reuse it (a retry never reserves twice).
  if public.lead_open_reservation(p_lead) > 0 then
    return true;
  end if;
  -- The last round was charged (the email was written): never charge again, e.g. for a job that
  -- crashed after capturing and is retried. Only a fully released round opens a new one.
  v_round := public.lead_reserve_round(p_lead);
  if v_round is not null and exists (
    select 1 from public.credit_ledger where lead_id = p_lead and round = v_round and type = 'capture'
  ) then
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

  v_round := coalesce(v_round, 0) + 1;
  insert into public.credit_ledger (workspace_id, type, amount, campaign_id, lead_id, note, kind, round)
  values (v_ws, 'reserve', -p_amount, v_campaign, p_lead, 'reserve', v_kind, v_round);
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
  v_round int;
  v_open int;
  v_take int;
begin
  select workspace_id, campaign_id into v_ws, v_campaign from public.leads where id = p_lead;
  if v_ws is null then
    raise exception 'lead % not found', p_lead using errcode = 'P0002';
  end if;
  perform 1 from public.workspaces where id = v_ws for update;
  v_round := public.lead_reserve_round(p_lead);
  if v_round is null then
    raise exception 'no reservation exists for lead %', p_lead using errcode = 'P0002';
  end if;
  select kind into v_kind from public.credit_ledger where lead_id = p_lead and type = 'reserve' and round = v_round;
  v_open := public.lead_open_reservation(p_lead);
  v_take := least(greatest(coalesce(p_amount, 0), 0), v_open);
  if v_take = 0 then
    return 0;
  end if;
  insert into public.credit_ledger (workspace_id, type, amount, campaign_id, lead_id, note, kind, round)
  values (v_ws, 'capture', v_take, v_campaign, p_lead, 'capture', v_kind, v_round);
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
  v_round int;
  v_open int;
begin
  select workspace_id, campaign_id into v_ws, v_campaign from public.leads where id = p_lead;
  if v_ws is null then
    raise exception 'lead % not found', p_lead using errcode = 'P0002';
  end if;
  perform 1 from public.workspaces where id = v_ws for update;
  v_round := public.lead_reserve_round(p_lead);
  if v_round is null then
    raise exception 'no reservation exists for lead %', p_lead using errcode = 'P0002';
  end if;
  select kind into v_kind from public.credit_ledger where lead_id = p_lead and type = 'reserve' and round = v_round;
  v_open := public.lead_open_reservation(p_lead);
  if v_open <= 0 then
    return 0;
  end if;
  insert into public.credit_ledger (workspace_id, type, amount, campaign_id, lead_id, note, kind, round)
  values (v_ws, 'release', v_open, v_campaign, p_lead, 'release', v_kind, v_round);
  return v_open;
end;
$$;

revoke all on function public.lead_reserve_round(uuid) from public, anon, authenticated;
revoke all on function public.reserve_credits(uuid, int) from public, anon, authenticated;
revoke all on function public.capture_credits(uuid, int) from public, anon, authenticated;
revoke all on function public.release_credits(uuid) from public, anon, authenticated;
grant execute on function public.reserve_credits(uuid, int) to service_role;
grant execute on function public.capture_credits(uuid, int) to service_role;
grant execute on function public.release_credits(uuid) to service_role;
