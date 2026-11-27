-- 1) Texts and emails clearly come from the business, "Powered by Spannr".
-- 2) Complimentary plans (e.g. LNC Automotive Services, Spannr's founding business): full Business access, never billed.

alter table public.businesses add column if not exists complimentary boolean not null default false;

create or replace function public.business_plan(bid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when b.complimentary then 'business'
    when b.plan is not null and b.plan_status in ('active', 'trialing', 'past_due') then b.plan
    when b.trial_ends_at > now() then 'trial'
    else 'expired' end
  from public.businesses b where b.id = bid;
$$;

-- No "your trial is ending" emails for complimentary businesses.
create or replace function public.trial_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select id, trial_ends_at from public.businesses
    where plan is null and not complimentary and trial_ends_at > now() and trial_ends_at <= now() + interval '7 days'
      and (trial_email_7d_at is null or (trial_ends_at <= now() + interval '1 day' and trial_email_1d_at is null))
  loop
    if r.trial_ends_at <= now() + interval '1 day' then
      perform public.send_trial_reminder(r.id, 1);
      update public.businesses set trial_email_1d_at = now(), trial_email_7d_at = coalesce(trial_email_7d_at, now()) where id = r.id;
    else
      perform public.send_trial_reminder(r.id, greatest(1, ceil(extract(epoch from r.trial_ends_at - now()) / 86400)::int));
      update public.businesses set trial_email_7d_at = now() where id = r.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.trial_reminders() from public, anon, authenticated;

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
  biz text;
  sms_body text;
begin
  for m in select * from public.notifications where status = 'queued' order by created_at limit 50 for update skip locked loop
    select data into st from public.settings where business_id = m.business_id and id = 'settings';
    biz := nullif(trim(coalesce(st ->> 'businessName', '')), '');
    if m.channel = 'sms' then
      -- Make it obvious which business is texting, and that it's powered by Spannr.
      sms_body := m.body;
      if biz is not null and position(lower(biz) in lower(sms_body)) = 0 then sms_body := biz || ': ' || sms_body; end if;
      sms_body := sms_body || E'\n- Powered by Spannr';
      -- Monthly text allowance for the business's plan.
      if (select count(*) from public.notifications x
          where x.business_id = m.business_id and x.channel = 'sms' and x.status in ('sent', 'sending')
            and x.created_at >= date_trunc('month', now() at time zone 'Australia/Sydney') at time zone 'Australia/Sydney')
         >= public.plan_sms_allowance(public.business_plan(m.business_id)) then
        update public.notifications set status = 'skipped', error = 'Monthly text allowance used up for this plan' where id = m.id;
        continue;
      end if;
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
          jsonb_strip_nulls(jsonb_build_object('source', 'spannr', 'to', m.to_address, 'body', sms_body, 'from', nullif(sms_from, ''))))),
        timeout_milliseconds := 15000) into req;
    else
      if coalesce(rs_key, '') = '' or coalesce(email_from, '') = '' then
        update public.notifications set status = 'skipped', error = 'Email is not set up yet' where id = m.id;
        continue;
      end if;
      select net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || rs_key),
        body := jsonb_strip_nulls(jsonb_build_object(
          'from', coalesce(nullif(st ->> 'businessName', ''), 'Spannr') || ' <' || email_from || '>',
          'to', jsonb_build_array(m.to_address),
          'reply_to', nullif(st ->> 'email', ''),
          'subject', m.subject,
          'text', m.body || E'\n\n—\nPowered by Spannr',
          'html', public.email_html(st, m.body),
          'attachments', public.email_logo(st))),
        timeout_milliseconds := 15000) into req;
    end if;
    update public.notifications set status = 'sending', request_id = req where id = m.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.email_html(st jsonb, body text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  color text := coalesce(nullif(st ->> 'brandColor', ''), '#f59e0b');
  biz text := coalesce(nullif(st ->> 'businessName', ''), 'Your mechanic');
  esc text;
  contact text := '';
  has_logo boolean := coalesce(st ->> 'logo', '') like 'data:image/%;base64,%';
  e text;
begin
  if color !~ '^#[0-9a-fA-F]{6}$' then color := '#f59e0b'; end if;
  e := replace(replace(replace(coalesce(body, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  e := regexp_replace(e, '(https?://[^\s<]+)', '<a href="\1" style="color:' || color || ';font-weight:600">\1</a>', 'g');
  esc := replace(e, E'\n', '<br>');
  biz := replace(replace(replace(biz, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  if coalesce(st ->> 'phone', '') <> '' then contact := contact || replace(replace(st ->> 'phone', '<', ''), '>', ''); end if;
  if coalesce(st ->> 'email', '') <> '' then
    contact := contact || case when contact <> '' then ' · ' else '' end || replace(replace(st ->> 'email', '<', ''), '>', '');
  end if;
  return '<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">'
    || '<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">'
    || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border-top:6px solid ' || color || '">'
    || '<tr><td style="padding:24px 28px 8px">'
    || case when has_logo then '<img src="cid:logo" alt="' || biz || '" style="max-height:56px;max-width:220px;display:block;margin-bottom:8px">' else '' end
    || '<div style="font-size:20px;font-weight:800;color:' || color || '">' || biz || '</div></td></tr>'
    || '<tr><td style="padding:12px 28px 24px;font-size:15px;line-height:1.6;color:#27272a">' || esc || '</td></tr>'
    || case when contact <> '' then '<tr><td style="padding:16px 28px;border-top:1px solid #e4e4e7;font-size:13px;color:#71717a">' || contact || '</td></tr>' else '' end
    || '</table>'
    || '<p style="font-size:12px;color:#a1a1aa;margin:16px 0 0">Powered by <strong style="color:#f59e0b">Spannr</strong> &middot; job management for mechanics</p>'
    || '</td></tr></table></body></html>';
end $$;
