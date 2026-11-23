-- Mechanic App: multi-business cloud schema with offline-first sync.
-- Every synced table stores the app's record as JSON plus sync metadata.

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  next_job_number int not null default 1001,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'tech')),
  email text not null default '',
  name text not null default '',
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index if not exists members_user_idx on public.members (user_id);

create table if not exists public.invites (
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'tech')),
  created_at timestamptz not null default now(),
  primary key (business_id, email)
);

-- ---------- Helpers ----------

create or replace function public.is_member(bid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.business_id = bid and m.user_id = auth.uid());
$$;

create or replace function public.is_admin(bid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.business_id = bid and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  );
$$;

-- ---------- Business tables RLS ----------

alter table public.businesses enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;

drop policy if exists "members read business" on public.businesses;
create policy "members read business" on public.businesses for select to authenticated using (public.is_member(id));
drop policy if exists "admins update business" on public.businesses;
create policy "admins update business" on public.businesses for update to authenticated
  using (public.is_admin(id)) with check (public.is_admin(id));

drop policy if exists "members read members" on public.members;
create policy "members read members" on public.members for select to authenticated using (public.is_member(business_id));
drop policy if exists "admins remove staff" on public.members;
create policy "admins remove staff" on public.members for delete to authenticated
  using (public.is_admin(business_id) and role <> 'owner');
drop policy if exists "admins change staff role" on public.members;
create policy "admins change staff role" on public.members for update to authenticated
  using (public.is_admin(business_id) and role <> 'owner')
  with check (public.is_admin(business_id) and role <> 'owner');

drop policy if exists "admins manage invites" on public.invites;
create policy "admins manage invites" on public.invites for all to authenticated
  using (public.is_admin(business_id)) with check (public.is_admin(business_id));

-- ---------- RPCs ----------

create or replace function public.create_business(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare bid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.businesses (name) values (coalesce(nullif(trim(p_name), ''), 'My business')) returning id into bid;
  insert into public.members (business_id, user_id, role, email)
    values (bid, auth.uid(), 'owner', coalesce(auth.jwt() ->> 'email', ''));
  return bid;
end $$;

-- Joins the signed-in user to every business that invited their (verified) email.
create or replace function public.claim_invites() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  n int := 0;
begin
  if auth.uid() is null then return 0; end if;
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  insert into public.members (business_id, user_id, role, email)
    select i.business_id, auth.uid(), i.role, v_email from public.invites i where lower(i.email) = v_email
    on conflict do nothing;
  get diagnostics n = row_count;
  delete from public.invites i where lower(i.email) = v_email;
  return n;
end $$;

-- ---------- Synced record tables ----------

create or replace function public.sync_row_guard() returns trigger
language plpgsql as $$
begin
  -- Last write wins: ignore an update older than what is already stored.
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.server_ts := clock_timestamp();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['customers', 'vehicles', 'jobs', 'catalog', 'settings', 'photos'] loop
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
      create trigger %1$s_guard before insert or update on public.%1$I
        for each row execute function public.sync_row_guard();
      drop policy if exists "members read" on public.%1$I;
      create policy "members read" on public.%1$I for select to authenticated using (public.is_member(business_id));
    $f$, t);

    if t = 'settings' then
      execute format($f$
        drop policy if exists "admins write" on public.%1$I;
        create policy "admins write" on public.%1$I for insert to authenticated with check (public.is_admin(business_id));
        drop policy if exists "admins update" on public.%1$I;
        create policy "admins update" on public.%1$I for update to authenticated
          using (public.is_admin(business_id)) with check (public.is_admin(business_id));
      $f$, t);
    else
      execute format($f$
        drop policy if exists "members write" on public.%1$I;
        create policy "members write" on public.%1$I for insert to authenticated with check (public.is_member(business_id));
        drop policy if exists "members update" on public.%1$I;
        create policy "members update" on public.%1$I for update to authenticated
          using (public.is_member(business_id)) with check (public.is_member(business_id));
      $f$, t);
    end if;
  end loop;
end $$;

-- Hands out the next job/invoice number. Never goes below the highest existing job
-- number or the "start from" number in settings, so numbers stay unique across devices.
create or replace function public.allocate_job_number(bid uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.is_member(bid) then raise exception 'Not a member of this business'; end if;
  perform 1 from public.businesses where id = bid for update;
  select greatest(
    (select b.next_job_number from public.businesses b where b.id = bid),
    coalesce((select max((j.data ->> 'number')::int) from public.jobs j where j.business_id = bid), 0) + 1,
    coalesce((select (s.data ->> 'nextJobNumber')::int from public.settings s where s.business_id = bid and s.id = 'settings'), 0)
  ) into n;
  update public.businesses set next_job_number = n + 1 where id = bid;
  return n;
end $$;

revoke execute on function public.create_business(text) from anon;
revoke execute on function public.claim_invites() from anon;
revoke execute on function public.allocate_job_number(uuid) from anon;

-- ---------- Photo storage ----------

insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;

drop policy if exists "members read photos" on storage.objects;
create policy "members read photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "members upload photos" on storage.objects;
create policy "members upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "members update photos" on storage.objects;
create policy "members update photos" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "members delete photos" on storage.objects;
create policy "members delete photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));
