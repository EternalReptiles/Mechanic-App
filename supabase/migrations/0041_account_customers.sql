-- Fleet / account customers pay on their monthly statement, so they don't get automatic unpaid-invoice reminders.

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
    where not j.deleted and j.data ->> 'imported' is null
      and j.data ->> 'status' in ('invoiced', 'completed')
      and coalesce((s.data -> 'notify' -> 'payReminders' ->> 'enabled')::boolean, false)
      and not coalesce((c.data ->> 'noAutoMessages')::boolean, false)
      and not coalesce((c.data -> 'account' ->> 'enabled')::boolean, false)  -- account customers pay on their statement
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
