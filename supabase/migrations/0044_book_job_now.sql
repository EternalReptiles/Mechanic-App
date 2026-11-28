-- "Book job" button: the booking confirmation goes out on the next run (within a minute).
-- A short-notice booking gets one text, not a reminder and then a confirmation.

CREATE OR REPLACE FUNCTION public.queue_notifications()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    where not j.deleted and j.data ->> 'imported' is null
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
       -- Pressing "Book job" (bookedAt) means it's ready now – no need to wait for typing to finish.
       and (r.updated_at < (extract(epoch from now()) * 1000)::bigint - 120000 or r.jd ? 'bookedAt')
       and not exists (
         select 1 from public.notifications x
         where x.business_id = r.business_id and x.job_id = r.job_id and x.kind in ('confirmation', 'reminder')
           and x.booking_at = r.start_at) then
      kinds := array_append(kinds, 'confirmation');
    end if;
    -- Reminder: inside the reminder window, at least 15 minutes ahead, and not if the
    -- booking was confirmed inside the window anyway (i.e. booked at short notice).
    -- (Also not in the same pass as a confirmation for a booking already inside the window.)
    if r.rem_on and not ('confirmation' = any(kinds)) and now() >= r.start_at - make_interval(hours => r.rem_hours)
       and r.start_at > now() + interval '15 minutes'
       -- Not while the booking is still being typed in (it gets a confirmation instead).
       and (r.updated_at < (extract(epoch from now()) * 1000)::bigint - 120000 or r.jd ? 'bookedAt')
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
end $function$;
