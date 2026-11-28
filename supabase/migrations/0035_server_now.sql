-- The server's clock, so devices with a wrong date/time still stamp their changes correctly.
create or replace function public.server_now() returns bigint
language sql stable as $$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;
grant execute on function public.server_now() to authenticated;
