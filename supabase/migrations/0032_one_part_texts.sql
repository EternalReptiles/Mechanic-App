-- One-part texts: short links, plain punctuation, tighter wording, and no "Powered by Spannr" on texts
-- (it stays on emails, invoices and the booking page). A text is 160 characters; one curly quote or dash
-- drops that to 70, so texts are kept to plain characters.

-- ---------- short links: https://spannr.au/r/<code> ----------
create table if not exists public.short_links (
  code text primary key,
  url text not null,
  business_id uuid references public.businesses(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.short_links enable row level security;
create index if not exists short_links_url_idx on public.short_links (business_id, url);

create or replace function public.make_short_link(bid uuid, long_url text) returns text
language plpgsql security definer set search_path = '' as $$
declare c text; abc text := 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  select s.code into c from public.short_links s where s.business_id is not distinct from bid and s.url = long_url limit 1;
  if c is not null then return 'https://spannr.au/r/' || c; end if;
  loop
    c := '';
    for i in 1..10 loop c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    begin
      insert into public.short_links (code, url, business_id) values (c, long_url, bid);
      exit;
    exception when unique_violation then -- try another code
    end;
  end loop;
  return 'https://spannr.au/r/' || c;
end $$;
revoke execute on function public.make_short_link(uuid, text) from public, anon, authenticated;

-- Used by spannr.au/r/<code> to redirect.
create or replace function public.resolve_short_link(p_code text) returns text
language sql stable security definer set search_path = '' as $$
  select url from public.short_links where code = p_code;
$$;
grant execute on function public.resolve_short_link(text) to anon, authenticated;

-- ---------- tidy a text before it's queued ----------
create or replace function public.sms_tidy(bid uuid, t text) returns text
language plpgsql security definer set search_path = '' as $$
declare u text;
begin
  -- Plain punctuation instead of "smart" characters (phones add these automatically).
  t := translate(t, U&'\2018\2019\201A\201B\201C\201D\201E\201F\2013\2014\2010\2011\2012\2212\00A0\202F', '''''''''""""------  ');
  t := replace(replace(t, U&'\2026', '...'), U&'\2022', '-');
  -- Long links become short ones.
  for u in select distinct m[1] from regexp_matches(t, '(https?://[^\s]+)', 'g') as m loop
    if length(u) > 40 and u not like 'https://spannr.au/r/%' then
      t := replace(t, u, public.make_short_link(bid, u));
    end if;
  end loop;
  return t;
end $$;
revoke execute on function public.sms_tidy(uuid, text) from public, anon, authenticated;

-- The exact text a customer receives (no "Powered by" on texts any more).
create or replace function public.sms_final_body(biz text, kind text, body text) returns text
language sql immutable set search_path = '' as $$
  select case when biz is not null and position(lower(biz) in lower(body)) = 0 then biz || ': ' || body else body end
    || case when kind in ('confirmation', 'reminder') then E'\nReply Y to confirm, C to cancel.' else '' end;
$$;

create or replace function public.notification_sms_est() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.channel = 'sms' then
    new.body := public.sms_tidy(new.business_id, new.body);
    new.sms_est := public.sms_part_count(public.sms_final_body(
      (select nullif(trim(s.data ->> 'businessName'), '') from public.settings s where s.business_id = new.business_id and s.id = 'settings'),
      new.kind, new.body));
  end if;
  return new;
end $$;

-- Businesses still on the old default booking wording get the new, shorter default.
update public.settings set data = jsonb_set(data, '{notify,confirmTemplate}',
    to_jsonb('Hi {name}, you''re booked with {business} {day} {time}{where}.'::text))
  where id = 'settings' and data -> 'notify' ->> 'confirmTemplate' in ('Hi {name}, you''re booked with {business} {day} {time}{where}. Questions? Call {phone}.', 'Hi {name}, you''re booked in with {business} {day} at {time}{where}. Reply or call {phone} if you need to change it.');
update public.settings set data = jsonb_set(data, '{notify,reminderTemplate}',
    to_jsonb('Hi {name}, reminder: you''re booked with {business} {day} {time}{where}.'::text))
  where id = 'settings' and data -> 'notify' ->> 'reminderTemplate' in ('Hi {name}, reminder: you''re booked with {business} {day} {time}{where}. Questions? Call {phone}.', 'Hi {name}, a reminder from {business}: your booking is {day} at {time}{where}. Reply or call {phone} if you need to change it.');

-- ---------- shorter default booking texts ----------
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
      -- Automatic messages are a Pro-and-up feature.
      and public.plan_rank(public.business_plan(j.business_id)) >= 2
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
      'Hi {name}, you''re booked with {business} {day} {time}{where}.'), vars);
    body_rem := public.fill_template(coalesce(nullif(r.st -> 'notify' ->> 'reminderTemplate', ''),
      'Hi {name}, reminder: you''re booked with {business} {day} {time}{where}.'), vars);

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

-- ---------- unpaid invoice reminders: one-part text ----------
create or replace function public.queue_payment_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
  pr jsonb;
  base timestamptz;
  stage int;
  days int;
  due timestamptz;
  local_now timestamp;
  total numeric;
  link text;
  payline text;
  body text;
  sms_text text;
  first text;
  addr text;
  ch text;
  biz text;
begin
  for r in
    select j.business_id, j.id as job_id, j.data as jd, s.data as st, c.data as cd,
      coalesce(nullif(s.data ->> 'timezone', ''), 'Australia/Sydney') as tz
    from public.jobs j
    join public.settings s on s.business_id = j.business_id and s.id = 'settings' and not s.deleted
    join public.customers c on c.business_id = j.business_id and c.id = j.data ->> 'customerId' and not c.deleted
    where not j.deleted
      and j.data ->> 'status' in ('invoiced', 'completed')
      and coalesce((s.data -> 'notify' -> 'payReminders' ->> 'enabled')::boolean, false)
      and not coalesce((c.data ->> 'noAutoMessages')::boolean, false)
      and public.plan_rank(public.business_plan(j.business_id)) >= 2
      and jsonb_array_length(coalesce(j.data -> 'lineItems', '[]'::jsonb)) > 0
  loop
    -- Business hours only: Mon–Sat, 9am–6pm in the business's time zone.
    local_now := now() at time zone r.tz;
    if extract(dow from local_now) = 0 or local_now::time < time '09:00' or local_now::time >= time '18:00' then continue; end if;

    pr := r.st -> 'notify' -> 'payReminders';
    base := coalesce(nullif(r.jd ->> 'invoicedAt', ''), nullif(r.jd ->> 'finishedAt', ''))::timestamptz;
    if base is null then continue; end if;

    foreach stage in array array[1, 2] loop
      days := case when stage = 1 then coalesce((pr ->> 'firstDays')::int, 3) else coalesce((pr ->> 'secondDays')::int, 7) end;
      if days <= 0 then continue; end if;
      due := base + make_interval(days => days);
      -- Due now, not long ago (so switching reminders on doesn't chase old invoices), and after they were switched on.
      if now() < due or now() > due + interval '3 days' then continue; end if;
      if due < to_timestamp(coalesce((pr ->> 'enabledAt')::bigint, 0) / 1000.0) then continue; end if;
      if exists (select 1 from public.notifications x where x.business_id = r.business_id and x.job_id = r.job_id
                 and x.kind = 'payment_reminder' and x.booking_at = due) then continue; end if;

      select round(coalesce(sum((l ->> 'qty')::numeric * (l ->> 'unitPrice')::numeric), 0)
             * case when coalesce((r.st ->> 'gstRegistered')::boolean, true) then 1.1 else 1 end, 2)
        into total from jsonb_array_elements(r.jd -> 'lineItems') l;
      if total <= 0 then continue; end if;

      select i.hosted_invoice_url into link from public.stripe_invoices i
       where i.business_id = r.business_id and i.job_id = r.job_id and i.status = 'open' order by i.created_at desc limit 1;
      payline := case
        when link is not null then 'Pay by card here: ' || link
        when coalesce(r.st ->> 'bsb', '') <> '' and coalesce(r.st ->> 'accountNumber', '') <> '' then
          'Bank transfer: ' || coalesce(nullif(r.st ->> 'accountName', ''), r.st ->> 'businessName', '') || ', BSB ' || (r.st ->> 'bsb')
          || ', account ' || (r.st ->> 'accountNumber') || ', reference ' || (r.jd ->> 'number') || '.'
        else 'Please get in touch if you have any questions.' end;
      biz := coalesce(nullif(r.st ->> 'businessName', ''), 'us');
      first := coalesce(nullif(split_part(trim(r.cd ->> 'name'), ' ', 1), ''), 'there');
      body := 'Hi ' || first || ', a friendly reminder from ' || biz || ' that invoice #' || (r.jd ->> 'number') || ' for $'
        || to_char(total, 'FM999,990.00') || case when stage = 1 then ' is now due. ' else ' is now overdue. ' end
        || payline || ' Thanks!';
      -- Texts are kept to one part (160 characters).
      sms_text := 'Hi ' || first || ', invoice #' || (r.jd ->> 'number') || ' ($' || to_char(total, 'FM999,990.00') || ') from ' || biz
        || case when stage = 1 then ' is now due. ' else ' is overdue. ' end
        || case when link is not null then 'Pay here: ' || link
                when coalesce(r.st ->> 'bsb', '') <> '' and coalesce(r.st ->> 'accountNumber', '') <> '' then
                  'BSB ' || (r.st ->> 'bsb') || ' Acc ' || (r.st ->> 'accountNumber') || ' Ref ' || (r.jd ->> 'number')
                else 'Thanks!' end;

      foreach ch in array array['sms', 'email'] loop
        if ch = 'sms' and not coalesce((r.st -> 'notify' ->> 'sms')::boolean, true) then continue; end if;
        if ch = 'email' and not coalesce((r.st -> 'notify' ->> 'email')::boolean, true) then continue; end if;
        addr := case when ch = 'sms' then public.au_mobile(r.cd ->> 'phone') else nullif(trim(coalesce(r.cd ->> 'email', '')), '') end;
        if addr is null then continue; end if;
        insert into public.notifications (business_id, job_id, kind, channel, booking_at, to_address, subject, body)
        values (r.business_id, r.job_id, 'payment_reminder', ch, due, addr,
          case when stage = 1 then 'Invoice #' else 'Overdue: invoice #' end || (r.jd ->> 'number') || ' from ' || biz,
          case when ch = 'sms' then sms_text else body end)
        on conflict do nothing;
        if found then n := n + 1; end if;
      end loop;
    end loop;
  end loop;
  if n > 0 then perform public.send_notifications(); end if;
  return n;
end $$;

-- ---------- review requests: shorter ----------
create or replace function public.queue_review_requests() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
  rv jsonb;
  paid timestamptz;
  local_now timestamp;
  ch text;
  addr text;
  body text;
  biz text;
begin
  for r in
    select j.business_id, j.id as job_id, j.data as jd, s.data as st, c.id as cust_id, c.data as cd,
      coalesce(nullif(s.data ->> 'timezone', ''), 'Australia/Sydney') as tz
    from public.jobs j
    join public.settings s on s.business_id = j.business_id and s.id = 'settings' and not s.deleted
    join public.customers c on c.business_id = j.business_id and c.id = j.data ->> 'customerId' and not c.deleted
    where not j.deleted and j.data ->> 'status' = 'paid' and coalesce(j.data ->> 'paidAt', '') <> ''
      and coalesce((s.data -> 'notify' -> 'reviews' ->> 'enabled')::boolean, false)
      and coalesce(s.data -> 'notify' -> 'reviews' ->> 'url', '') ~ '^https?://'
      and not coalesce((c.data ->> 'noAutoMessages')::boolean, false)
      and public.plan_rank(public.business_plan(j.business_id)) >= 2
      and (j.data ->> 'paidAt')::timestamptz > now() - interval '3 days'
  loop
    local_now := now() at time zone r.tz;
    if local_now::time < time '09:00' or local_now::time >= time '19:00' then continue; end if;
    rv := r.st -> 'notify' -> 'reviews';
    paid := (r.jd ->> 'paidAt')::timestamptz;
    if now() < paid + make_interval(hours => coalesce((rv ->> 'delayHours')::int, 2)) then continue; end if;
    if paid < to_timestamp(coalesce((rv ->> 'enabledAt')::bigint, 0) / 1000.0) then continue; end if;
    -- Once per job, and not more than once per customer every 120 days.
    if exists (select 1 from public.notifications x where x.business_id = r.business_id and x.kind = 'review_request'
               and (x.job_id = r.job_id or (x.created_at > now() - interval '120 days' and x.to_address in (
                 public.au_mobile(r.cd ->> 'phone'), nullif(trim(coalesce(r.cd ->> 'email', '')), ''))))) then continue; end if;

    biz := coalesce(nullif(r.st ->> 'businessName', ''), 'us');
    body := 'Thanks ' || coalesce(nullif(split_part(trim(r.cd ->> 'name'), ' ', 1), ''), 'again')
      || '! If you were happy with the job, a quick Google review would really help ' || biz || ': ' || (rv ->> 'url');
    -- Prefer a text; email if there's no mobile.
    ch := case when public.au_mobile(r.cd ->> 'phone') is not null and coalesce((r.st -> 'notify' ->> 'sms')::boolean, true) then 'sms'
               when nullif(trim(coalesce(r.cd ->> 'email', '')), '') is not null and coalesce((r.st -> 'notify' ->> 'email')::boolean, true) then 'email' end;
    if ch is null then continue; end if;
    addr := case when ch = 'sms' then public.au_mobile(r.cd ->> 'phone') else trim(r.cd ->> 'email') end;
    insert into public.notifications (business_id, job_id, kind, channel, booking_at, to_address, subject, body)
    values (r.business_id, r.job_id, 'review_request', ch, paid, addr, 'Thanks from ' || biz, body)
    on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  if n > 0 then perform public.send_notifications(); end if;
  return n;
end $$;
