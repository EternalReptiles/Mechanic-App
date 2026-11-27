-- 1) Card fee breakdown on paid jobs  2) Closing a business (deleted 90 days later)  3) Spannr admin page

-- ---------- 1) Fees ----------
alter table public.stripe_terminal_payments add column if not exists stripe_fee int;
alter table public.stripe_terminal_payments add column if not exists net int;
alter table public.stripe_invoices add column if not exists stripe_fee int;
alter table public.stripe_invoices add column if not exists net int;

-- ---------- 2) Closing a business ----------
alter table public.businesses add column if not exists closed_at timestamptz;
alter table public.businesses add column if not exists closed_by uuid;

-- The owner closes the business. Its data is kept 90 days (it can be reopened), then deleted.
create or replace function public.close_business(bid uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare b record;
begin
  if not exists (select 1 from public.members where business_id = bid and user_id = auth.uid() and role = 'owner') then
    raise exception 'Only the owner can close the business account.';
  end if;
  select * into b from public.businesses where id = bid;
  if b.complimentary then raise exception 'This account can''t be closed from the app – contact Spannr.'; end if;
  if b.plan is not null and b.plan_status in ('active', 'trialing', 'past_due') and not coalesce(b.cancel_at_period_end, false) then
    raise exception 'Cancel your Spannr plan first (Settings → Plan & billing → Manage billing), then close the account.';
  end if;
  update public.businesses set closed_at = now(), closed_by = auth.uid() where id = bid;
  return now() + interval '90 days';
end $$;
grant execute on function public.close_business(uuid) to authenticated;

create or replace function public.reopen_business(bid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.members where business_id = bid and user_id = auth.uid() and role = 'owner') then
    raise exception 'Only the owner can reopen the business account.';
  end if;
  update public.businesses set closed_at = null, closed_by = null where id = bid;
end $$;
grant execute on function public.reopen_business(uuid) to authenticated;

-- A closed business can't use paid features or send messages until it's reopened.
create or replace function public.business_plan(bid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when b.closed_at is not null then 'expired'
    when b.complimentary then 'business'
    when b.plan is not null and b.plan_status in ('active', 'trialing', 'past_due') then b.plan
    when b.trial_ends_at > now() then 'trial'
    else 'expired' end
  from public.businesses b where b.id = bid;
$$;

-- Businesses due for permanent deletion (used by the daily purge function).
create or replace function public.businesses_due_for_deletion() returns table (id uuid)
language sql stable security definer set search_path = '' as $$
  select b.id from public.businesses b where b.closed_at is not null and b.closed_at < now() - interval '90 days' and not b.complimentary
$$;
revoke execute on function public.businesses_due_for_deletion() from public, anon, authenticated;
grant execute on function public.businesses_due_for_deletion() to service_role;

-- ---------- 3) Spannr admins ----------
create table if not exists public.spannr_admins (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.spannr_admins enable row level security;  -- no policies: read through the functions below
grant all on public.spannr_admins to service_role;

create or replace function public.is_spannr_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.spannr_admins where user_id = auth.uid())
$$;
grant execute on function public.is_spannr_admin() to authenticated;

-- Every business with its plan, usage and key dates (admins only).
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_spannr_admin() then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
      select b.id, b.name, b.created_at, b.trial_ends_at, b.plan, b.plan_status, b.plan_interval, b.current_period_end,
        b.cancel_at_period_end, b.complimentary, b.closed_at,
        public.business_plan(b.id) as effective,
        (select m.email from public.members m where m.business_id = b.id and m.role = 'owner' limit 1) as owner_email,
        (select count(*) from public.members m where m.business_id = b.id) as users,
        (select count(*) from public.jobs j where j.business_id = b.id and not j.deleted) as jobs,
        (select count(*) from public.customers c where c.business_id = b.id and not c.deleted) as customers,
        (select max(j.server_ts) from public.jobs j where j.business_id = b.id) as last_activity,
        public.sms_used_this_month(b.id) as sms_used,
        public.plan_sms_allowance(public.business_plan(b.id)) as sms_allowance,
        (select count(*) from public.notifications n where n.business_id = b.id and n.channel = 'email' and n.status in ('sent', 'sending')
           and n.created_at >= date_trunc('month', now())) as emails_month,
        (select s.card_payments_status from public.stripe_accounts s where s.business_id = b.id) as card_payments,
        (select s.data ->> 'businessType' from public.settings s where s.business_id = b.id and s.id = 'settings') as business_type
      from public.businesses b
    ) x), '[]'::jsonb);
end $$;
grant execute on function public.admin_overview() to authenticated;

create or replace function public.admin_set_complimentary(bid uuid, on_ boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_spannr_admin() then raise exception 'Not allowed'; end if;
  update public.businesses set complimentary = on_ where id = bid;
end $$;
grant execute on function public.admin_set_complimentary(uuid, boolean) to authenticated;

-- Give a business more trial days (admins only).
create or replace function public.admin_extend_trial(bid uuid, days int) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare t timestamptz;
begin
  if not public.is_spannr_admin() then raise exception 'Not allowed'; end if;
  if days < 1 or days > 365 then raise exception 'Between 1 and 365 days'; end if;
  update public.businesses
     set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => days),
         trial_email_7d_at = null, trial_email_1d_at = null
   where id = bid returning trial_ends_at into t;
  return t;
end $$;
grant execute on function public.admin_extend_trial(uuid, int) to authenticated;

-- Daily at 3:17am Sydney-ish (17:17 UTC): delete businesses closed more than 90 days ago.
select cron.unschedule('spannr-purge-closed') where exists (select 1 from cron.job where jobname = 'spannr-purge-closed');
select cron.schedule('spannr-purge-closed', '17 17 * * *', $c$
  select net.http_post(
    url := 'https://lmtmsnkjowgeturblzzj.supabase.co/functions/v1/purge-closed',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-purge-token', public.notify_secret('purge_token')),
    body := '{}'::jsonb, timeout_milliseconds := 60000)
$c$);
