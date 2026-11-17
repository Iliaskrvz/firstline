-- Marketing batch 5: lifetime totals for the homepage counter ("X emails personalised · Y leads skipped
-- for free"). Lead rows are deleted 30 days after a campaign ends; the retention job adds their counts
-- here first, in the same transaction, so the totals never go down. Only numbers, no personal data.
create table if not exists public.lifetime_counts (
  key text primary key check (key in ('personalised', 'neutral')),
  value bigint not null default 0 check (value >= 0),
  updated_at timestamptz not null default now()
);

alter table public.lifetime_counts enable row level security;
