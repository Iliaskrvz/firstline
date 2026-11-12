-- Phase 11: Deep research (behind a switch that stays off until the lawyer and Anthropic confirm).
-- Person facts are stored ONLY with the lead (deleted with it, 30 days after the campaign ends),
-- never in the shared domain_research cache and never across workspaces. Local was dropped.
alter table public.leads
  add column deep_status text check (deep_status in ('matched', 'no_match', 'not_searched')),
  add column deep_detail text,
  add column person_facts jsonb;   -- at most 2: [{id, text, src, tier: "D"}]
