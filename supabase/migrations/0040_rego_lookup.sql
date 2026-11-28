-- Rego lookups, counted per business per month (fair-use cap – each lookup costs Spannr).
create table if not exists public.rego_usage (
  business_id uuid not null references public.businesses(id) on delete cascade,
  month text not null,
  count int not null default 0,
  primary key (business_id, month)
);
alter table public.rego_usage enable row level security;

create or replace function public.rego_use(bid uuid, lim int) returns int
language plpgsql security definer set search_path = public as $$
declare m text := to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM'); n int;
begin
  insert into rego_usage (business_id, month, count) values (bid, m, 1)
  on conflict (business_id, month) do update set count = rego_usage.count + 1
  where rego_usage.count < lim
  returning count into n;
  return coalesce(n, -1);
end $$;
revoke all on function public.rego_use(uuid, int) from public, anon, authenticated;
grant execute on function public.rego_use(uuid, int) to service_role;
