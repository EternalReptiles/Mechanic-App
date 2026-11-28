-- The owner types the person's name when inviting them; it carries over when they join.
alter table public.invites add column if not exists name text;

create or replace function public.claim_invites() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  n int := 0;
begin
  if auth.uid() is null then return 0; end if;
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  insert into public.members (business_id, user_id, role, email, name)
    select i.business_id, auth.uid(), i.role, v_email, nullif(trim(coalesce(i.name, '')), '') from public.invites i where lower(i.email) = v_email
    on conflict do nothing;
  get diagnostics n = row_count;
  delete from public.invites i where lower(i.email) = v_email;
  return n;
end $$;
