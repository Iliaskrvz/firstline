-- Phase 3: Gmail sender (Sender Sheet + /api/sender/next|report).
-- The sender API authenticates with a per-inbox key and writes through the
-- server's database connection; members only read sends and inboxes.

-- Campaign: run + send settings.
alter table public.campaigns
  add column send_fallbacks boolean not null default true,  -- chosen before the run: send the neutral version, or skip
  add column inbox_id uuid,
  add column opt_out_line text,
  add column send_state text check (send_state in ('sending', 'paused')),
  add foreign key (inbox_id, workspace_id) references public.inboxes (id, workspace_id) on delete set null (inbox_id);

-- Admin switch (§11): disable the Sender API per workspace. Not writable by members.
alter table public.workspaces add column sender_disabled boolean not null default false;

-- Inbox scheduler state. The key itself is never stored, only its hash and a short prefix.
alter table public.inboxes
  add column key_prefix        text,
  add column next_send_at      timestamptz,
  add column warmup_updated_on date,
  add column step_back_on      date,
  add column script_version    text,
  add column errors_on         date,
  add column errors_today      int not null default 0,
  add column last_error        text;

-- Sends: a snapshot of exactly what goes out, plus scheduler bookkeeping.
alter table public.sends drop constraint sends_status_check;
alter table public.sends add constraint sends_status_check
  check (status in ('queued', 'paused', 'sent', 'replied', 'bounced', 'stopped'));
alter table public.sends
  add column campaign_id      uuid,
  add column to_email         text,
  add column subject          text,
  add column body             text,
  add column status_detail    text,          -- "Colleague replied", "Unsubscribed", ...
  add column handed_out_at    timestamptz,   -- given to the script, not reported yet (lease)
  add column watch_checked_at timestamptz,   -- last time the script was asked to check this thread
  add column replied_at       timestamptz,
  add column bounced_at       timestamptz,
  add foreign key (campaign_id, workspace_id) references public.campaigns (id, workspace_id) on delete cascade;

create index sends_inbox_queue_idx on public.sends (inbox_id, status, created_at);
create index sends_inbox_thread_idx on public.sends (inbox_id, gmail_thread_id) where gmail_thread_id is not null;
create index sends_campaign_idx on public.sends (campaign_id, status);
create index suppression_email_idx on public.suppression (workspace_id, lower(email)) where email is not null;
create index suppression_domain_idx on public.suppression (workspace_id, domain) where domain is not null;

-- Members may see the new non-secret inbox columns (the key hash stays hidden).
grant select (key_prefix, next_send_at, script_version, errors_today, last_error) on public.inboxes to authenticated;
