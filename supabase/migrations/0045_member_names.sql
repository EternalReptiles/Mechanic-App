-- Names for team members (shown on jobs, timesheets and "On my way" texts).
-- Owners and admins can name anyone in the business; everyone can change their own.
create or replace function public.set_member_name(bid uuid, uid uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_admin(bid) or (uid = auth.uid() and public.is_member(bid))) then
    raise exception 'Only an owner or admin can change someone else''s name';
  end if;
  update public.members set name = left(trim(coalesce(p_name, '')), 60) where business_id = bid and user_id = uid;
end $$;
revoke all on function public.set_member_name(uuid, uuid, text) from public, anon;
grant execute on function public.set_member_name(uuid, uuid, text) to authenticated;
