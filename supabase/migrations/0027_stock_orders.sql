-- Stock (parts on hand) and purchase orders: two more synced record tables, same shape as the others.
do $$
declare t text;
begin
  foreach t in array array['stock', 'orders'] loop
    execute format($f$
      create table if not exists public.%1$I (
        business_id uuid not null references public.businesses(id) on delete cascade,
        id text not null,
        data jsonb not null default '{}'::jsonb,
        updated_at bigint not null,
        deleted boolean not null default false,
        server_ts timestamptz not null default clock_timestamp(),
        primary key (business_id, id)
      );
      create index if not exists %1$s_pull_idx on public.%1$I (business_id, server_ts);
      alter table public.%1$I enable row level security;
      drop trigger if exists %1$s_guard on public.%1$I;
      create trigger %1$s_guard before insert or update on public.%1$I for each row execute function public.sync_row_guard();
      drop policy if exists "members read" on public.%1$I;
      create policy "members read" on public.%1$I for select to authenticated using (public.is_member(business_id));
      drop policy if exists "members write" on public.%1$I;
      create policy "members write" on public.%1$I for insert to authenticated with check (public.is_member(business_id));
      drop policy if exists "members update" on public.%1$I;
      create policy "members update" on public.%1$I for update to authenticated
        using (public.is_member(business_id)) with check (public.is_member(business_id));
      grant select, insert, update on public.%1$I to authenticated;
      grant all on public.%1$I to service_role;
    $f$, t);
  end loop;
end $$;
