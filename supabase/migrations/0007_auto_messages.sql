-- Automatic booking confirmations and reminders (SMS via ClickSend, email via Resend).
-- Runs entirely in the database: pg_cron calls run_notifications() every minute, which
--   1) records results of messages already handed to the providers,
--   2) queues new confirmations / reminders for upcoming bookings,
--   3) sends queued messages with pg_net.
-- Provider keys live in Supabase Vault (names: clicksend_username, clicksend_api_key,
-- resend_api_key, email_from, optional sms_from). Missing keys => message marked 'skipped'.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  job_id text not null,
  kind text not null check (kind in ('confirmation', 'reminder')),
  channel text not null check (channel in ('sms', 'email')),
  booking_at timestamptz not null,
  to_address text not null,
  subject text,
  body text not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  error text,
  request_id bigint,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (business_id, job_id, kind, channel, booking_at)
);
create index if not exists notifications_job_idx on public.notifications (business_id, job_id);
create index if not exists notifications_status_idx on public.notifications (status) where status in ('queued', 'sending');

alter table public.notifications enable row level security;
drop policy if exists "members read notifications" on public.notifications;
create policy "members read notifications" on public.notifications for select to authenticated using (public.is_member(business_id));
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

-- ---------- helpers ----------

create or replace function public.notify_secret(p_name text) returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;
revoke execute on function public.notify_secret(text) from public, anon, authenticated;

-- Which providers are set up (for the Settings screen). Never returns the keys.
create or replace function public.notify_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'sms', exists (select 1 from vault.decrypted_secrets where name = 'clicksend_api_key' and coalesce(decrypted_secret, '') <> '')
       and exists (select 1 from vault.decrypted_secrets where name = 'clicksend_username' and coalesce(decrypted_secret, '') <> ''),
    'email', exists (select 1 from vault.decrypted_secrets where name = 'resend_api_key' and coalesce(decrypted_secret, '') <> '')
       and exists (select 1 from vault.decrypted_secrets where name = 'email_from' and coalesce(decrypted_secret, '') <> '')
  );
$$;
revoke execute on function public.notify_status() from public, anon;
grant execute on function public.notify_status() to authenticated;

-- Australian mobile number in international format, or null if it isn't a mobile.
create or replace function public.au_mobile(p text) returns text
language sql immutable as $$
  select case
    when d ~ '^04[0-9]{8}$' then '+61' || substr(d, 2)
    when d ~ '^614[0-9]{8}$' then '+' || d
    else null end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

create or replace function public.fill_template(tpl text, vars jsonb) returns text
language plpgsql immutable as $$
declare k text; v text; out text := tpl;
begin
  for k, v in select * from jsonb_each_text(vars) loop
    out := replace(out, '{' || k || '}', coalesce(v, ''));
  end loop;
  return regexp_replace(out, '\s+', ' ', 'g');
end $$;

-- ---------- 1) queue ----------

create or replace function public.queue_notifications() returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int := 0;
  r record;
  local_now timestamp;
  start_local timestamp;
  day_text text;
  where_text text;
  vars jsonb;
  body_conf text;
  body_rem text;
  ch text;
  addr text;
  kinds text[];
  k text;
begin
  for r in
    select
      j.business_id, j.id as job_id, j.data as jd, j.updated_at,
      (j.data ->> 'scheduledStart')::timestamptz as start_at,
      s.data as st,
      coalesce(nullif(s.data ->> 'timezone', ''), 'Australia/Sydney') as tz,
      coalesce((s.data -> 'notify' ->> 'confirmEnabled')::boolean, false) as conf_on,
      coalesce((s.data -> 'notify' ->> 'reminderEnabled')::boolean, false) as rem_on,
      coalesce((s.data -> 'notify' ->> 'reminderHours')::int, 24) as rem_hours,
      coalesce((s.data -> 'notify' ->> 'sms')::boolean, true) as sms_on,
      coalesce((s.data -> 'notify' ->> 'email')::boolean, true) as email_on,
      coalesce((s.data -> 'notify' ->> 'enabledAt')::bigint, 0) as enabled_at,
      c.data as cd, v.data as vd
    from public.jobs j
    join public.settings s on s.business_id = j.business_id and s.id = 'settings' and not s.deleted
    left join public.customers c on c.business_id = j.business_id and c.id = j.data ->> 'customerId' and not c.deleted
    left join public.vehicles v on v.business_id = j.business_id and v.id = j.data ->> 'vehicleId' and not v.deleted
    where not j.deleted
      and j.data ->> 'status' = 'scheduled'
      and coalesce(j.data ->> 'scheduledStart', '') <> ''
      and (j.data ->> 'scheduledStart')::timestamptz > now()
      and (coalesce((s.data -> 'notify' ->> 'confirmEnabled')::boolean, false)
           or coalesce((s.data -> 'notify' ->> 'reminderEnabled')::boolean, false))
      and c.data is not null
      and not coalesce((c.data ->> 'noAutoMessages')::boolean, false)
  loop
    -- Quiet hours: nothing between 9pm and 7:30am in the business's time zone.
    local_now := now() at time zone r.tz;
    if local_now::time >= time '21:00' or local_now::time < time '07:30' then continue; end if;

    kinds := '{}';
    -- Confirmation: once per booking time, a couple of minutes after the last edit
    -- (so it isn't sent while the mechanic is still typing), and only for bookings
    -- made/changed after automatic messages were switched on.
    if r.conf_on and r.updated_at >= r.enabled_at
       and r.updated_at < (extract(epoch from now()) * 1000)::bigint - 120000
       and not exists (
         select 1 from public.notifications x
         where x.business_id = r.business_id and x.job_id = r.job_id and x.kind = 'confirmation'
           and x.booking_at = r.start_at) then
      kinds := array_append(kinds, 'confirmation');
    end if;
    -- Reminder: inside the reminder window, at least 15 minutes ahead, and not if the
    -- booking was confirmed inside the window anyway (i.e. booked at short notice).
    -- (Also not in the same pass as a confirmation for a booking already inside the window.)
    if r.rem_on and not ('confirmation' = any(kinds)) and now() >= r.start_at - make_interval(hours => r.rem_hours)
       and r.start_at > now() + interval '15 minutes'
       and not exists (
         select 1 from public.notifications x
         where x.business_id = r.business_id and x.job_id = r.job_id and x.kind = 'confirmation'
           and x.booking_at = r.start_at and x.created_at > r.start_at - make_interval(hours => r.rem_hours)) then
      kinds := array_append(kinds, 'reminder');
    end if;
    if cardinality(kinds) = 0 then continue; end if;

    start_local := r.start_at at time zone r.tz;
    day_text := case
      when start_local::date = local_now::date then 'today'
      when start_local::date = local_now::date + 1 then 'tomorrow'
      else 'on ' || to_char(start_local, 'FMDy FMDD FMMon') end;
    where_text := case
      when r.jd ->> 'location' = 'workshop' then
        case when coalesce(r.st ->> 'address', '') <> '' then ' at our workshop, ' || (r.st ->> 'address') else ' at our workshop' end
      when coalesce(r.jd ->> 'siteAddress', r.cd ->> 'address', '') <> '' then ' at ' || coalesce(nullif(r.jd ->> 'siteAddress', ''), r.cd ->> 'address')
      else '' end;
    vars := jsonb_build_object(
      'name', split_part(trim(coalesce(r.cd ->> 'name', '')), ' ', 1),
      'business', coalesce(r.st ->> 'businessName', ''),
      'day', day_text,
      'date', to_char(start_local, 'FMDy FMDD FMMon'),
      'time', lower(to_char(start_local, 'FMHH12:MIam')),
      'where', where_text,
      'vehicle', coalesce(nullif(trim(coalesce(r.vd ->> 'make', '') || ' ' || coalesce(r.vd ->> 'model', '')), ''), r.vd ->> 'rego', 'vehicle'),
      'phone', coalesce(nullif(r.st ->> 'phone', ''), 'us'));
    body_conf := public.fill_template(coalesce(nullif(r.st -> 'notify' ->> 'confirmTemplate', ''),
      'Hi {name}, you''re booked in with {business} {day} at {time}{where}. Reply or call {phone} if you need to change it.'), vars);
    body_rem := public.fill_template(coalesce(nullif(r.st -> 'notify' ->> 'reminderTemplate', ''),
      'Hi {name}, a reminder from {business}: your booking is {day} at {time}{where}. Reply or call {phone} if you need to change it.'), vars);

    foreach k in array kinds loop
      foreach ch in array array['sms', 'email'] loop
        if ch = 'sms' and not r.sms_on then continue; end if;
        if ch = 'email' and not r.email_on then continue; end if;
        addr := case when ch = 'sms' then public.au_mobile(r.cd ->> 'phone') else nullif(trim(coalesce(r.cd ->> 'email', '')), '') end;
        if addr is null then continue; end if;
        insert into public.notifications (business_id, job_id, kind, channel, booking_at, to_address, subject, body)
        values (r.business_id, r.job_id, k, ch, r.start_at, addr,
          case when k = 'confirmation' then 'Booking confirmed – ' else 'Booking reminder – ' end || coalesce(r.st ->> 'businessName', ''),
          case when k = 'confirmation' then body_conf else body_rem end)
        on conflict do nothing;
        if found then n := n + 1; end if;
      end loop;
    end loop;
  end loop;
  return n;
end $$;

-- ---------- 2) send ----------

create or replace function public.send_notifications() returns int
language plpgsql security definer set search_path = '' as $$
declare
  m record;
  n int := 0;
  cs_user text := public.notify_secret('clicksend_username');
  cs_key text := public.notify_secret('clicksend_api_key');
  sms_from text := public.notify_secret('sms_from');
  rs_key text := public.notify_secret('resend_api_key');
  email_from text := public.notify_secret('email_from');
  st jsonb;
  req bigint;
begin
  for m in select * from public.notifications where status = 'queued' order by created_at limit 50 for update skip locked loop
    if m.channel = 'sms' then
      if coalesce(cs_user, '') = '' or coalesce(cs_key, '') = '' then
        update public.notifications set status = 'skipped', error = 'Text messages are not set up yet' where id = m.id;
        continue;
      end if;
      select net.http_post(
        url := 'https://rest.clicksend.com/v3/sms/send',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Basic ' || replace(encode(convert_to(cs_user || ':' || cs_key, 'UTF8'), 'base64'), E'\n', '')),
        body := jsonb_build_object('messages', jsonb_build_array(
          jsonb_strip_nulls(jsonb_build_object('source', 'spannr', 'to', m.to_address, 'body', m.body, 'from', nullif(sms_from, ''))))),
        timeout_milliseconds := 15000) into req;
    else
      if coalesce(rs_key, '') = '' or coalesce(email_from, '') = '' then
        update public.notifications set status = 'skipped', error = 'Email is not set up yet' where id = m.id;
        continue;
      end if;
      select data into st from public.settings where business_id = m.business_id and id = 'settings';
      select net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || rs_key),
        body := jsonb_strip_nulls(jsonb_build_object(
          'from', coalesce(nullif(st ->> 'businessName', ''), 'Spannr') || ' <' || email_from || '>',
          'to', jsonb_build_array(m.to_address),
          'reply_to', nullif(st ->> 'email', ''),
          'subject', m.subject,
          'text', m.body)),
        timeout_milliseconds := 15000) into req;
    end if;
    update public.notifications set status = 'sending', request_id = req where id = m.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- 3) record results ----------

create or replace function public.check_notifications() returns int
language plpgsql security definer set search_path = '' as $$
declare m record; resp record; n int := 0; cs_status text;
begin
  for m in select * from public.notifications where status = 'sending' and request_id is not null for update skip locked loop
    select status_code, content, error_msg into resp from net._http_response where id = m.request_id;
    if not found then
      if m.created_at < now() - interval '15 minutes' then
        update public.notifications set status = 'failed', error = 'No response from provider' where id = m.id;
      end if;
      continue;
    end if;
    if resp.status_code between 200 and 299 then
      if m.channel = 'sms' then
        cs_status := (resp.content::jsonb) -> 'data' -> 'messages' -> 0 ->> 'status';
        if cs_status is not null and cs_status <> 'SUCCESS' then
          update public.notifications set status = 'failed', error = 'Text not sent: ' || cs_status where id = m.id;
          n := n + 1;
          continue;
        end if;
      end if;
      update public.notifications set status = 'sent', sent_at = now(), error = null where id = m.id;
    else
      update public.notifications set status = 'failed',
        error = left(coalesce(resp.error_msg, 'HTTP ' || resp.status_code || ': ' || coalesce(resp.content, '')), 300)
      where id = m.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.run_notifications() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a int; b int; c int;
begin
  a := public.check_notifications();
  b := public.queue_notifications();
  c := public.send_notifications();
  return jsonb_build_object('checked', a, 'queued', b, 'sent_to_provider', c);
end $$;

revoke execute on function public.queue_notifications() from public, anon, authenticated;
revoke execute on function public.send_notifications() from public, anon, authenticated;
revoke execute on function public.check_notifications() from public, anon, authenticated;
revoke execute on function public.run_notifications() from public, anon, authenticated;

-- Every minute.
select cron.unschedule(jobid) from cron.job where jobname = 'spannr-notifications';
select cron.schedule('spannr-notifications', '* * * * *', 'select public.run_notifications()');
