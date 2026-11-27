-- AI assistant usage, counted per business per month (fair-use cap).
create table if not exists public.ai_usage (
  business_id uuid not null references public.businesses(id) on delete cascade,
  month text not null,
  count int not null default 0,
  primary key (business_id, month)
);
alter table public.ai_usage enable row level security;
create policy ai_usage_read on public.ai_usage for select using (public.is_member(business_id));

-- Counts one request; returns the new count, or -1 when the monthly limit is reached.
create or replace function public.ai_use(bid uuid, lim int) returns int
language plpgsql security definer set search_path = public as $$
declare m text := to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM'); n int;
begin
  insert into ai_usage (business_id, month, count) values (bid, m, 1)
  on conflict (business_id, month) do update set count = ai_usage.count + 1
  where ai_usage.count < lim
  returning count into n;
  return coalesce(n, -1);
end $$;
revoke all on function public.ai_use(uuid, int) from public, anon, authenticated;
grant execute on function public.ai_use(uuid, int) to service_role;
