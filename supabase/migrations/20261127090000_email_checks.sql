-- Part A: free email checks. Each lead gets a status (pending → valid / risky / invalid) with reasons;
-- domains' DNS results are cached for 7 days (server only). No SMTP, ever.

alter table public.leads
  add column email_status     text not null default 'pending' check (email_status in ('pending', 'valid', 'risky', 'invalid')),
  add column email_reason     text,                           -- the main reason (see src/lib/email-check.ts)
  add column email_reasons    text[] not null default '{}',   -- every reason that applies
  add column email_suggestion text,                           -- "did you mean …@gmail.com?" (never applied silently)
  add column email_checked_at timestamptz;

create index leads_email_status_idx on public.leads (campaign_id, email_status);

-- DNS results per domain (MX / A-only / null MX / none / unknown). Shared across workspaces: a domain's
-- DNS is public information, not customer data. Server only: RLS on, no policies, no grants.
create table public.email_domain_checks (
  domain     text primary key,
  result     text not null check (result in ('mx', 'a_only', 'null_mx', 'none', 'unknown')),
  checked_at timestamptz not null default now()
);
alter table public.email_domain_checks enable row level security;
revoke all on public.email_domain_checks from anon, authenticated;
