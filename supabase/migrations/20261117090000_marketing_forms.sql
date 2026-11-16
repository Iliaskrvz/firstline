-- Marketing batch 4.
-- 1. The homepage demo also runs in Dutch (/nl): the language is part of the 30-day result cache.
alter table public.demo_runs add column if not exists lang text not null default 'en' check (lang in ('en', 'nl'));

-- 2. "Talk to us" requests from /agencies. Read by the server only (RLS on, no policies).
--    The visitor's IP is stored only as a salted hash, for the per-day limit. Deleted after 180 days.
create table if not exists public.contact_requests (
  id bigint generated always as identity primary key,
  kind text not null default 'agency' check (kind in ('agency')),
  name text not null check (length(name) between 1 and 120),
  email text not null check (length(email) between 3 and 254),
  company text not null default '' check (length(company) <= 160),
  volume text not null default '' check (length(volume) <= 60),
  message text not null default '' check (length(message) <= 4000),
  ip_hash text not null,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);

create index if not exists contact_requests_created_idx on public.contact_requests (created_at desc);
create index if not exists contact_requests_ip_idx on public.contact_requests (ip_hash, created_at);

alter table public.contact_requests enable row level security;
