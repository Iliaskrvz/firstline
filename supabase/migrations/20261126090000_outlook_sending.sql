-- Phase O2: send from Outlook / Microsoft 365 through Microsoft Graph, server-side in the worker.
-- The inbox model, scheduler and stop rules are the Gmail lane's; only the transport differs.

-- 1. A Microsoft 365 inbox, and a state for "the connection was revoked or expired".
alter table public.inboxes drop constraint if exists inboxes_type_check;
alter table public.inboxes add constraint inboxes_type_check check (type in ('gmail_script', 'gmail_oauth', 'outlook_oauth'));
alter table public.inboxes drop constraint if exists inboxes_health_check;
alter table public.inboxes add constraint inboxes_health_check check (health in ('healthy', 'warming', 'offline', 'paused', 'disconnected'));

-- 2. OAuth credentials, server only. RLS on and no policies or grants: members can't read this table at
--    all (not even their own row); only the server's database connection can. Tokens are AES-256-GCM
--    encrypted with INTEGRATIONS_ENCRYPTION_KEY before they get here (src/lib/secret-box.ts).
create table public.inbox_credentials (
  inbox_id               uuid primary key,
  workspace_id           uuid not null,
  provider               text not null check (provider in ('microsoft')),
  tenant_id              text not null,                 -- the customer's Microsoft Entra tenant (tid)
  account_id             text not null,                 -- their user object id (oid)
  scopes                 text not null,                 -- what was actually granted, space-separated
  refresh_token_enc      text,                          -- null after a disconnect
  access_token_enc       text,
  access_expires_at      timestamptz,
  delta_link_enc         text,                          -- where the next Inbox delta query continues
  checked_at             timestamptz,                   -- last reply/bounce check
  connected_at           timestamptz not null default now(),
  disconnected_at        timestamptz,
  disconnect_reason      text,
  disconnect_alerted_at  timestamptz,
  foreign key (inbox_id, workspace_id) references public.inboxes (id, workspace_id) on delete cascade
);
alter table public.inbox_credentials enable row level security;
revoke all on public.inbox_credentials from anon, authenticated;

-- 3. The Graph message id of each sent email: follow-ups are threaded replies to step 1's message.
--    (sends.gmail_thread_id holds the thread for both lanes: Gmail's thread id or Outlook's conversationId.)
alter table public.sends add column provider_message_id text;
