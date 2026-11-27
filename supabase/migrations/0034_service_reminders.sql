-- Automatic service reminders: N days before a car's next service is due, text (or email) the customer:
-- "Hi Sam, your Mazda CX5 (FIN011) is due for a service Thu 4 Dec. Book online: <link> or call 0400 000 000 to book."
-- Without online booking: "... Call 0400 000 000 to book." Settings: settings.data.notify.serviceReminders = { enabled, daysBefore }.
-- Once per car per due date, 9am–6pm in the business's time zone, never for customers who opted out.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('confirmation', 'reminder', 'receipt', 'message', 'payment_reminder', 'review_request', 'service_reminder'));

create or replace function public.queue_service_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
  local_now timestamp;
  due date;
  days_before int;
  car text;
  phone text;
  booking text;
  how text;
  ch text;
  addr text;
  body text;
  first text;
begin
  for r in
    select v.business_id, v.id as veh_id, v.data as vd, s.data as st, c.data as cd, b.booking_slug,
      coalesce(nullif(s.data ->> 'timezone', ''), 'Australia/Sydney') as tz
    from public.vehicles v
    join public.settings s on s.business_id = v.business_id and s.id = 'settings' and not s.deleted
    join public.businesses b on b.id = v.business_id and b.closed_at is null
    join public.customers c on c.business_id = v.business_id and c.id = v.data ->> 'customerId' and not c.deleted
    where not v.deleted
      and coalesce(v.data ->> 'nextServiceDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and coalesce((s.data -> 'notify' -> 'serviceReminders' ->> 'enabled')::boolean, false)
      and not coalesce((c.data ->> 'noAutoMessages')::boolean, false)
      and public.plan_rank(public.business_plan(v.business_id)) >= 2
  loop
    local_now := now() at time zone r.tz;
    if local_now::time < time '09:00' or local_now::time >= time '18:00' then continue; end if;
    due := (r.vd ->> 'nextServiceDate')::date;
    days_before := least(greatest(coalesce((r.st -> 'notify' -> 'serviceReminders' ->> 'daysBefore')::int, 14), 1), 60);
    -- Only upcoming services (not overdue ones), within the reminder window.
    if due < local_now::date or due > local_now::date + days_before then continue; end if;

    car := nullif(trim(concat_ws(' ', nullif(r.vd ->> 'make', ''), nullif(r.vd ->> 'model', ''))), '');
    car := coalesce(car, 'car') || coalesce(' (' || nullif(upper(trim(r.vd ->> 'rego')), '') || ')', '');
    phone := nullif(trim(coalesce(r.st ->> 'phone', '')), '');
    booking := case when r.booking_slug is not null and coalesce((r.st -> 'booking' ->> 'enabled')::boolean, false)
                    then 'https://app.spannr.au/book/' || r.booking_slug end;
    how := case
      when booking is not null and phone is not null then 'Book online: ' || booking || ' or call ' || phone || '.'
      when booking is not null then 'Book online: ' || booking
      when phone is not null then 'Call ' || phone || ' to book.'
      else 'Reply to this message to book.' end;
    first := coalesce(nullif(split_part(trim(r.cd ->> 'name'), ' ', 1), ''), 'there');
    body := 'Hi ' || first || ', your ' || car || ' is due for a service '
      || case when due = local_now::date then 'today' when due = local_now::date + 1 then 'tomorrow'
              else to_char(due, 'FMDy FMDD Mon') end || '. ' || how;

    -- Prefer a text; email if there's no mobile.
    ch := case when public.au_mobile(r.cd ->> 'phone') is not null and coalesce((r.st -> 'notify' ->> 'sms')::boolean, true) then 'sms'
               when nullif(trim(coalesce(r.cd ->> 'email', '')), '') is not null and coalesce((r.st -> 'notify' ->> 'email')::boolean, true) then 'email' end;
    if ch is null then continue; end if;
    addr := case when ch = 'sms' then public.au_mobile(r.cd ->> 'phone') else trim(r.cd ->> 'email') end;

    insert into public.notifications (business_id, job_id, kind, channel, booking_at, to_address, subject, body)
    values (r.business_id, 'vehicle:' || r.veh_id, 'service_reminder', ch, due::timestamptz, addr,
            'Service due for your ' || car, body)
    on conflict do nothing;   -- once per car per due date
    if found then n := n + 1; end if;
  end loop;
  if n > 0 then perform public.send_notifications(); end if;
  return n;
end $$;
revoke execute on function public.queue_service_reminders() from public, anon, authenticated;

select cron.unschedule('spannr-service-reminders') where exists (select 1 from cron.job where jobname = 'spannr-service-reminders');
select cron.schedule('spannr-service-reminders', '22,52 * * * *', 'select public.queue_service_reminders()');
