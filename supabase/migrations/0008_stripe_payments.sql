-- Stripe Connect card payments for repair invoices.
-- Mechanic businesses are connected accounts (Accounts v2, direct charges, full Dashboard,
-- Stripe-owned fees and losses). Only the Edge Functions (service role) write these tables;
-- members of a business can read their own rows.

create table if not exists public.stripe_accounts (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  account_id text not null unique,
  card_payments_status text not null default 'pending',
  gst_tax_rate_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_customers (
  business_id uuid not null references public.businesses(id) on delete cascade,
  spannr_customer_id text not null,
  stripe_customer_id text not null,
  primary key (business_id, spannr_customer_id)
);

create table if not exists public.stripe_invoices (
  id text primary key,                       -- Stripe invoice id (in_...)
  business_id uuid not null references public.businesses(id) on delete cascade,
  job_id text not null,
  account_id text not null,
  number text,
  status text not null,                      -- draft | open | paid | void | uncollectible
  total integer not null,                    -- cents, inc GST
  currency text not null default 'aud',
  hosted_invoice_url text,
  application_fee integer,
  last_event text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists stripe_invoices_job_idx on public.stripe_invoices (business_id, job_id);

-- Webhook events already handled (idempotency).
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_accounts enable row level security;
alter table public.stripe_customers enable row level security;
alter table public.stripe_invoices enable row level security;
alter table public.stripe_events enable row level security;

drop policy if exists "members read" on public.stripe_accounts;
create policy "members read" on public.stripe_accounts for select to authenticated using (public.is_member(business_id));
drop policy if exists "members read" on public.stripe_invoices;
create policy "members read" on public.stripe_invoices for select to authenticated using (public.is_member(business_id));

revoke all on public.stripe_accounts, public.stripe_customers, public.stripe_invoices, public.stripe_events from anon, authenticated;
grant select on public.stripe_accounts, public.stripe_invoices to authenticated;
