-- Newer Supabase projects don't grant table access to API roles by default.
-- Grant signed-in users only what the app needs; row-level security still limits
-- every query to the user's own business. Anonymous visitors get nothing.

revoke all on public.businesses, public.members, public.invites,
  public.customers, public.vehicles, public.jobs, public.catalog, public.settings, public.photos
  from anon;
revoke truncate, trigger, references on public.businesses, public.members, public.invites,
  public.customers, public.vehicles, public.jobs, public.catalog, public.settings, public.photos
  from authenticated;

grant select, update on public.businesses to authenticated;
grant select, update, delete on public.members to authenticated;
grant select, insert, update, delete on public.invites to authenticated;
-- Synced records are never hard-deleted through the API (deletions are synced as tombstones).
grant select, insert, update on public.customers, public.vehicles, public.jobs,
  public.catalog, public.settings, public.photos to authenticated;
