-- Newer Supabase projects don't grant table access to service_role by default.
-- Grant the Stripe Edge Functions exactly what they use.
grant select on public.members, public.settings, public.customers to service_role;
grant select, update on public.jobs to service_role;
grant select, insert, update, delete on public.stripe_accounts, public.stripe_customers,
  public.stripe_invoices, public.stripe_events to service_role;
