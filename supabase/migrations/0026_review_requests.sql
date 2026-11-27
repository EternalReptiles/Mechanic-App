-- Google review requests: a thank-you text/email a couple of hours after a job is paid, asking for a review.
-- Settings: settings.data.notify.reviews = { enabled, url, delayHours, enabledAt }. At most once per customer every 120 days.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('confirmation', 'reminder', 'receipt', 'message', 'payment_reminder', 'review_request'));

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
    body := 'Thanks for choosing ' || biz || ', ' || coalesce(nullif(split_part(trim(r.cd ->> 'name'), ' ', 1), ''), 'and thanks')
      || '! If you were happy with the job, we''d really appreciate a quick Google review – it helps a small business like ours a lot: '
      || (rv ->> 'url');
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
revoke execute on function public.queue_review_requests() from public, anon, authenticated;

select cron.unschedule('spannr-review-requests') where exists (select 1 from cron.job where jobname = 'spannr-review-requests');
select cron.schedule('spannr-review-requests', '7,37 * * * *', 'select public.queue_review_requests()');
