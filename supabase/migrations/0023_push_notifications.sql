-- Push notifications (iPhone app): device tokens, and a helper that asks the push-send function to deliver.

create table if not exists public.push_devices (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  platform text not null default 'ios',
  apns_env text,                          -- 'production' | 'sandbox' (learnt on first send)
  updated_at timestamptz not null default now()
);
create index if not exists push_devices_biz on public.push_devices (business_id);
alter table public.push_devices enable row level security;
grant all on public.push_devices to service_role;

create or replace function public.plan_allows_tap_to_pay(p text) returns boolean language sql immutable as $$
  select p in ('team', 'business', 'trial')
$$;

-- Called by the app after the user allows notifications.
create or replace function public.register_push_device(bid uuid, p_token text, p_platform text default 'ios') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(bid) then raise exception 'Not a member of this business'; end if;
  if coalesce(p_token, '') !~ '^[0-9a-fA-F]{32,200}$' then raise exception 'Bad device token'; end if;
  insert into public.push_devices (token, user_id, business_id, platform)
  values (lower(p_token), auth.uid(), bid, coalesce(nullif(p_platform, ''), 'ios'))
  on conflict (token) do update set user_id = excluded.user_id, business_id = excluded.business_id, updated_at = now();
end $$;
grant execute on function public.register_push_device(uuid, text, text) to authenticated;

create or replace function public.unregister_push_device(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_devices where token = lower(p_token) and user_id = auth.uid()
$$;
grant execute on function public.unregister_push_device(text) to authenticated;

-- Sends a push to a business's owners/admins (or everyone with admins_only = false). Fire-and-forget.
create or replace function public.push_to_business(bid uuid, p_title text, p_body text, p_url text default '/', p_admins_only boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if bid is null or not exists (select 1 from public.push_devices where business_id = bid) then return; end if;
  perform net.http_post(
    url := 'https://lmtmsnkjowgeturblzzj.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-token', public.notify_secret('push_token')),
    body := jsonb_build_object('business_id', bid, 'title', p_title, 'body', p_body, 'url', p_url, 'admins_only', p_admins_only),
    timeout_milliseconds := 45000);
end $$;
revoke execute on function public.push_to_business(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.push_to_business(uuid, text, text, text, boolean) to service_role;

-- Spannr admin: announce Tap to Pay on iPhone to every eligible business (Apple's launch requirement 6.3).
create or replace function public.admin_push_tap_to_pay_launch() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  if not public.is_spannr_admin() then raise exception 'Not allowed'; end if;
  for r in select b.id from public.businesses b
           where b.closed_at is null and public.plan_allows_tap_to_pay(public.business_plan(b.id))
             and exists (select 1 from public.push_devices d where d.business_id = b.id) loop
    perform public.push_to_business(r.id, 'Tap to Pay on iPhone is here',
      'Accept contactless payments right on your iPhone – no extra hardware needed. Tap to set it up.', '/settings/tap-to-pay', true);
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function public.admin_push_tap_to_pay_launch() to authenticated;


-- Failed Tap to Pay payments: email (0022) + push.
create or replace function public.notify_tap_failed(p_business uuid, p_job text, p_amount int, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  st jsonb;
  biz text;
  to_ text;
  num text;
  amt text := '$' || to_char(coalesce(p_amount, 0) / 100.0, 'FM999,990.00');
begin
  select data into st from public.settings where business_id = p_business and id = 'settings';
  biz := coalesce(nullif(st ->> 'businessName', ''), 'your business');
  to_ := coalesce(nullif(trim(st ->> 'email'), ''), (select m.email from public.members m where m.business_id = p_business and m.role = 'owner' limit 1));
  select j.data ->> 'number' into num from public.jobs j where j.business_id = p_business and j.id = p_job;
  perform public.send_spannr_email(to_, 'Tap to Pay payment not approved – ' || amt,
    public.spannr_email_html('Payment not approved',
      '<p>A Tap to Pay on iPhone payment of <strong>' || amt || '</strong>' || coalesce(' for job <strong>#' || num || '</strong>', '')
      || ' was <strong>not approved</strong>' || coalesce(' (' || public.html_escape(p_reason) || ')', '') || '. No money was taken.</p>'
      || '<p>Open the job in Spannr to try again, or send the customer a pay link.</p>'
      || '<p style="margin:20px 0"><a href="https://app.spannr.au/jobs/' || p_job || '?tab=billing" style="display:inline-block;background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Open the job</a></p>'),
    'A Tap to Pay payment of ' || amt || coalesce(' for job #' || num, '') || ' at ' || biz || ' was not approved. No money was taken.');
  perform public.push_to_business(p_business, 'Payment not approved',
    'The Tap to Pay payment of ' || amt || coalesce(' for job #' || num, '') || ' wasn''t approved. No money was taken.',
    '/jobs/' || p_job || '?tab=billing', true);
end $$;

-- New customer text → push to the business (unless it was an automatic "Y" confirmation, which is pre-read).
create or replace function public.push_new_text() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text; already_read boolean;
begin
  -- Runs at the end of the transaction, so a "Y" confirmation has already been marked read.
  select read_at is not null into already_read from public.sms_inbound where id = new.id;
  if new.business_id is null or coalesce(already_read, true) then return new; end if;
  select nullif(c.data ->> 'name', '') into who from public.customers c where c.business_id = new.business_id and c.id = new.customer_id;
  perform public.push_to_business(new.business_id, coalesce(who, regexp_replace(new.from_number, '^\+61', '0')),
    left(new.body, 180), coalesce('/jobs/' || new.job_id, '/messages'), false);
  return new;
exception when others then return new;
end $$;
drop trigger if exists push_new_text on public.sms_inbound;
create constraint trigger push_new_text after insert on public.sms_inbound
  deferrable initially deferred for each row execute function public.push_new_text();

-- Spannr admin: a test push to your own devices.
create or replace function public.admin_test_push() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  if not public.is_spannr_admin() then raise exception 'Not allowed'; end if;
  for r in select distinct business_id from public.push_devices where user_id = auth.uid() loop
    perform public.push_to_business(r.business_id, 'Spannr test', 'Push notifications are working 🎉', '/', true);
    n := n + 1;
  end loop;
  return (select count(*) from public.push_devices where user_id = auth.uid());
end $$;
grant execute on function public.admin_test_push() to authenticated;
