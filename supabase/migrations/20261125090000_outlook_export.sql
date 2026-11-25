-- Outlook export (Phase O1): emails exported as Outlook drafts count as outcomes on their own channel,
-- so reply-rate numbers can tell them apart from CSV exports. Phase O2 (sending via Microsoft 365) reuses it.
alter table public.outcomes drop constraint if exists outcomes_channel_check;
alter table public.outcomes add constraint outcomes_channel_check
  check (channel in ('gmail', 'csv', 'instantly', 'smartlead', 'lemlist', 'api', 'outlook'));
