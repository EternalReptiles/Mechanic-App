-- Spannr subscription plans: Solo / Pro / Team / Business, plus a 30-day free trial with
-- everything unlocked. Stripe (via the stripe-webhook function) is the only thing that
-- changes a business's plan; members can read it.

alter table public.businesses
  add column if not exists plan text check (plan in ('solo', 'pro', 'team', 'business')),
  add column if not exists plan_status text,            -- Stripe subscription status
  add column if not exists plan_interval text,          -- month | year
  add column if not exists trial_ends_at timestamptz default (now() + interval '30 days'),
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists stripe_subscription_id text;

-- Signed-in users may only rename their business, never change its plan.
revoke update on public.businesses from authenticated;
grant update (name) on public.businesses to authenticated;
grant select, update on public.businesses to service_role;

-- The plan in force right now.
create or replace function public.business_plan(bid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when b.plan is not null and b.plan_status in ('active', 'trialing', 'past_due') then b.plan
    when b.trial_ends_at > now() then 'trial'
    else 'expired' end
  from public.businesses b where b.id = bid;
$$;
grant execute on function public.business_plan(uuid) to authenticated, service_role;

create or replace function public.plan_rank(p text) returns int language sql immutable as $$
  select case p when 'solo' then 1 when 'pro' then 2 when 'team' then 3 when 'business' then 4 when 'trial' then 4 else 0 end;
$$;
create or replace function public.plan_user_limit(p text) returns int language sql immutable as $$
  select case p when 'solo' then 1 when 'pro' then 3 when 'team' then 8 when 'business' then 100000 when 'trial' then 100000 else 1 end;
$$;
create or replace function public.plan_sms_allowance(p text) returns int language sql immutable as $$
  select case p when 'pro' then 100 when 'team' then 300 when 'business' then 1000 when 'trial' then 50 else 0 end;
$$;

-- Remote sign-offs and video walk-arounds: Pro and up.
drop policy if exists "members send walkarounds" on public.walkarounds;
create policy "members send walkarounds" on public.walkarounds for insert to authenticated
  with check (public.is_member(business_id) and public.plan_rank(public.business_plan(business_id)) >= 2);

-- Team size: invites can't take the business past its plan's user limit.
drop policy if exists "admins manage invites" on public.invites;
create policy "admins read invites" on public.invites for select to authenticated using (public.is_admin(business_id));
create policy "admins cancel invites" on public.invites for delete to authenticated using (public.is_admin(business_id));
create policy "admins invite within plan" on public.invites for insert to authenticated
  with check (
    public.is_admin(business_id)
    and (select count(*) from public.members m where m.business_id = invites.business_id)
      + (select count(*) from public.invites i where i.business_id = invites.business_id)
      < public.plan_user_limit(public.business_plan(business_id)));
