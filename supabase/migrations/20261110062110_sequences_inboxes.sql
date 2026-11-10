-- Phase 4: follow-up steps in the same thread, several inboxes per campaign, inbox health alerts.

-- One generation per lead per step: step 1 is the template, later steps are personalised follow-ups.
alter table public.generations add column step_no int not null default 1 check (step_no >= 1);
create index generations_lead_step_idx on public.generations (lead_id, step_no, created_at desc);

-- A follow-up is due `delay_days` working days after the previous step went out (snapshot of the step).
alter table public.sends add column delay_days int not null default 0 check (delay_days >= 0);
create index sends_due_idx on public.sends (inbox_id, status, scheduled_for) where step_no > 1;

-- Leads are spread over these inboxes (round robin); follow-ups stay in the lead's inbox.
alter table public.campaigns add column inbox_ids uuid[] not null default '{}';
update public.campaigns set inbox_ids = array[inbox_id] where inbox_id is not null;

-- One "inbox offline" email per outage; cleared when the heartbeat comes back.
alter table public.inboxes add column offline_alerted_at timestamptz;
grant select (offline_alerted_at) on public.inboxes to authenticated;
