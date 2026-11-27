-- "Connect your existing Stripe account" (Stripe Connect OAuth). A linked account takes the business's
-- card payments; the account Spannr creates (account_id) is still used to bill the Spannr subscription.
alter table public.stripe_accounts alter column account_id drop not null;
alter table public.stripe_accounts add column if not exists linked_account_id text unique;
alter table public.stripe_accounts add column if not exists linked_at timestamptz;

-- One-time state values for the OAuth round trip (CSRF protection). Only the Edge Function touches this.
create table if not exists public.stripe_oauth_states (
  state text primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.stripe_oauth_states enable row level security;
