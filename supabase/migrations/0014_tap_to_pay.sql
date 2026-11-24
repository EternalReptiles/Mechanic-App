-- Tap to Pay: each business's Stripe Terminal location, and in-person payments per job.
alter table public.stripe_accounts add column if not exists terminal_location_id text;

create table if not exists public.stripe_terminal_payments (
  id text primary key,                 -- PaymentIntent id (on the business's Stripe account)
  business_id uuid not null references public.businesses(id) on delete cascade,
  job_id text not null,
  account_id text not null,
  amount int not null,
  application_fee int not null default 0,
  status text not null,
  receipt_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stripe_terminal_payments_job on public.stripe_terminal_payments (business_id, job_id);
alter table public.stripe_terminal_payments enable row level security;
drop policy if exists "members read" on public.stripe_terminal_payments;
create policy "members read" on public.stripe_terminal_payments for select to authenticated using (public.is_member(business_id));
grant select on public.stripe_terminal_payments to authenticated;
grant all on public.stripe_terminal_payments to service_role;
