-- Owner's own outreach test (2026-11-27):
--   1. An admin can let one workspace (the owner's) use the real Claude provider while everyone else
--      stays on test output. Server-only table: customers can update their own workspace row, so the
--      switch must not live there.
--   2. Everything that workspace costs while the switch is on is "own use": kept out of the customer
--      margin and shown as Lab/own use on /admin.
--   3. A 50/50 split test per campaign: half the leads get the owner's plain copy (holdout), half get
--      FirstLine; replies, and replies marked positive, are compared per half.

-- 1. The switch.
create table public.workspace_llm_overrides (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  provider     text not null check (provider in ('anthropic')),
  set_by       text not null,
  set_at       timestamptz not null default now()
);
alter table public.workspace_llm_overrides enable row level security;
revoke all on public.workspace_llm_overrides from anon, authenticated;

-- 2. Own-use costs.
alter table public.usage_costs add column own_use boolean not null default false;
create index usage_costs_own_use_idx on public.usage_costs (created_at) where own_use;

create or replace function public.usage_costs_own_use() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is not null and exists (select 1 from public.workspace_llm_overrides o where o.workspace_id = new.workspace_id) then
    new.own_use := true;
  end if;
  return new;
end;
$$;
create trigger usage_costs_own_use before insert on public.usage_costs
  for each row execute function public.usage_costs_own_use();

-- 3. The split test: { share: 0.5, plain_subject, plain_body } on the campaign; the half per lead.
alter table public.campaigns add column split_test jsonb
  check (split_test is null or (split_test ? 'plain_body' and (split_test->>'share')::numeric > 0 and (split_test->>'share')::numeric < 1));
alter table public.leads add column split_variant text check (split_variant in ('holdout', 'firstline'));

-- Replies the owner marked as positive (FirstLine never reads replies; this is a manual mark).
alter table public.sends add column reply_positive boolean;
alter table public.outcomes add column split_variant text, add column reply_positive boolean;

-- Outcome rows keep the half, and a holdout email is never counted as personalised.
create or replace function public.outcome_split_variant() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.split_variant is null and new.lead_id is not null then
    select l.split_variant into new.split_variant from public.leads l where l.id = new.lead_id;
  end if;
  if new.split_variant = 'holdout' then
    new.personalised := false;
  end if;
  return new;
end;
$$;
create trigger outcomes_split_variant before insert on public.outcomes
  for each row execute function public.outcome_split_variant();
