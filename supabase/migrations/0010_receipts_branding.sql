-- Card payment receipts (sent through the automatic-messages pipeline) and Stripe branding sync.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('confirmation', 'reminder', 'receipt'));
grant select, insert on public.notifications to service_role;

-- Fingerprint of the logo + colour last copied to the business's Stripe account.
alter table public.stripe_accounts add column if not exists branding_hash text;
