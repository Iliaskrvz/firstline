-- Phase 8: Smartlead and Lemlist.
-- Smartlead webhooks are set up per campaign on the first push (account-wide ones would replace the
-- customer's own); hooked_campaigns lists the tool campaigns that have ours. Campaigns without one are polled.
alter table public.integrations add column hooked_campaigns text[] not null default '{}';
