-- Live sync: devices get a nudge the moment another device saves a change (instead of waiting
-- for the 30-second check). The app only uses it as a signal and then pulls as usual; rows are
-- still filtered by each table's read policy, so people only hear about their own business.
do $$
declare t text;
begin
  foreach t in array array['customers', 'vehicles', 'jobs', 'catalog', 'settings', 'photos', 'stock', 'orders'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
