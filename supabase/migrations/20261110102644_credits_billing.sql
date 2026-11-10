-- Phase 5: welcome credits (§9), auto top-up state, cancelling a run.

-- Free-mail providers (same list as src/lib/domain.ts; a test keeps them equal).
create or replace function public.is_free_mail_domain(p_domain text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce(p_domain, '')) = any (array['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.nl', 'outlook.com', 'outlook.nl', 'live.com', 'live.nl', 'msn.com', 'yahoo.com', 'yahoo.nl', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.de', 'gmx.net', 'web.de', 'ziggo.nl', 'kpnmail.nl', 'planet.nl', 'home.nl', 'telenet.be', 'skynet.be']);
$$;

-- 25 welcome credits once the email address is verified. A company domain gets them once
-- (the first account on it); free-mail addresses (gmail.com, …) once per address.
create table public.welcome_grants (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email_domain text,              -- null for free-mail addresses
  created_at   timestamptz not null default now()
);
create unique index welcome_grants_domain_idx on public.welcome_grants (email_domain) where email_domain is not null;
alter table public.welcome_grants enable row level security;  -- server only: no policies

create or replace function public.grant_welcome_credits(p_user uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_confirmed timestamptz;
  v_ws uuid;
  v_domain text;
begin
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = p_user;
  if v_confirmed is null or v_email is null then
    return 0;
  end if;
  select id into v_ws from public.workspaces where owner_id = p_user order by created_at limit 1;
  if v_ws is null then
    return 0;
  end if;
  v_domain := lower(split_part(v_email, '@', 2));
  if public.is_free_mail_domain(v_domain) then
    v_domain := null;
  end if;
  begin
    insert into public.welcome_grants (user_id, workspace_id, email_domain) values (p_user, v_ws, v_domain);
  exception when unique_violation then
    return 0;  -- this user, or someone on this company domain, already got them
  end;
  insert into public.credit_ledger (workspace_id, type, amount, note, stripe_event_id)
  values (v_ws, 'bonus', 25, 'Welcome credits', 'welcome:' || p_user);
  return 25;
end;
$$;
revoke all on function public.grant_welcome_credits(uuid) from public, anon, authenticated;
grant execute on function public.grant_welcome_credits(uuid) to service_role;

create or replace function public.on_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null and (tg_op = 'INSERT' or old.email_confirmed_at is null) then
    perform public.grant_welcome_credits(new.id);
  end if;
  return new;
end;
$$;
-- Named so it runs after on_auth_user_created (which makes the workspace): triggers fire in name order.
create trigger on_auth_user_email_confirmed
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.on_email_confirmed();

-- Accounts that were already verified get theirs now.
select public.grant_welcome_credits(id) from auth.users where email_confirmed_at is not null;
