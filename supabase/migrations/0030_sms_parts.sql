-- Count texts the way ClickSend bills them: each 160 characters (70 with emoji or other special
-- characters) is one text. The allowance is measured on the final text, including the business name,
-- "Reply Y to confirm…" and "Powered by Spannr".

-- The exact text a customer receives.
create or replace function public.sms_final_body(biz text, kind text, body text) returns text
language sql immutable set search_path = '' as $$
  select case when biz is not null and position(lower(biz) in lower(body)) = 0 then biz || ': ' || body else body end
    || case when kind in ('confirmation', 'reminder') then E'\nReply Y to confirm or C to cancel.' else '' end
    || E'\n- Powered by Spannr';
$$;

-- How many texts (SMS parts) a message uses.
create or replace function public.sms_part_count(t text) returns int
language plpgsql immutable set search_path = '' as $$
declare gsm text := '@£$¥èéùìòÇ' || E'\n' || 'Øø' || E'\r' || 'ÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&''()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  ext text := '^{}\[~]|€'; n int := 0; c text;
begin
  t := coalesce(t, '');
  foreach c in array regexp_split_to_array(t, '') loop
    if position(c in gsm) > 0 then n := n + 1;
    elsif position(c in ext) > 0 then n := n + 2;
    else
      -- Anything else (emoji, curly quotes…) switches the whole text to unicode: 70 a part, 67 when split.
      n := char_length(t) + (select count(*) from regexp_matches(t, '[\U00010000-\U0010FFFF]', 'g'))::int;
      return case when n <= 70 then 1 else ceil(n / 67.0)::int end;
    end if;
  end loop;
  return case when n <= 160 then 1 else ceil(n / 153.0)::int end;
end $$;

alter table public.notifications add column if not exists sms_est int;

create or replace function public.notification_sms_est() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.channel = 'sms' then
    new.sms_est := public.sms_part_count(public.sms_final_body(
      (select nullif(trim(s.data ->> 'businessName'), '') from public.settings s where s.business_id = new.business_id and s.id = 'settings'),
      new.kind, new.body));
  end if;
  return new;
end $$;
drop trigger if exists notification_sms_est on public.notifications;
create trigger notification_sms_est before insert on public.notifications
  for each row execute function public.notification_sms_est();

-- Fill in this month's estimates.
update public.notifications n set sms_est = public.sms_part_count(public.sms_final_body(
    (select nullif(trim(s.data ->> 'businessName'), '') from public.settings s where s.business_id = n.business_id and s.id = 'settings'), n.kind, n.body))
  where n.channel = 'sms' and n.sms_est is null and n.created_at > now() - interval '40 days';

-- Texts used this month = parts actually billed (or estimated, until ClickSend confirms).
create or replace function public.sms_used_this_month(bid uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(coalesce(x.sms_parts, x.sms_est, 1)), 0)::int from public.notifications x
  where x.business_id = bid and x.channel = 'sms' and x.status in ('queued', 'sent', 'sending')
    and x.created_at >= date_trunc('month', now() at time zone 'Australia/Sydney') at time zone 'Australia/Sydney'
$$;

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
      sms_body := public.sms_final_body(biz, m.kind, m.body);
      -- Monthly text allowance for the business's plan.
      if (select coalesce(sum(coalesce(x.sms_parts, x.sms_est, 1)), 0) from public.notifications x
          where x.business_id = m.business_id and x.channel = 'sms' and x.status in ('sent', 'sending')
            and x.created_at >= date_trunc('month', now() at time zone 'Australia/Sydney') at time zone 'Australia/Sydney')
         + coalesce(m.sms_est, 1) > public.plan_sms_allowance(public.business_plan(m.business_id)) then
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
          jsonb_strip_nulls(jsonb_build_object('source', 'spannr', 'to', m.to_address, 'body', sms_body, 'from', nullif(sms_from, ''), 'custom_string', m.id::text)))),
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

create or replace function public.send_customer_message(
  p_business uuid, p_customer text, p_job text, p_channel text, p_subject text, p_body text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  cust jsonb;
  addr text;
  plan text;
  nid uuid;
begin
  if not public.is_member(p_business) then raise exception 'Not a member of this business'; end if;
  if p_channel not in ('sms', 'email') then raise exception 'Unknown channel'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'The message is empty'; end if;
  if length(p_body) > 1500 then raise exception 'The message is too long'; end if;
  plan := public.business_plan(p_business);
  if plan = 'expired' then raise exception 'Your Spannr trial has ended – choose a plan to keep sending messages.'; end if;

  select c.data into cust from public.customers c
    where c.business_id = p_business and c.id = p_customer and not coalesce(c.deleted, false);
  if cust is null then raise exception 'Customer not found – make sure it has synced.'; end if;

  if p_channel = 'sms' then
    addr := public.au_mobile(cust ->> 'phone');
    if addr is null then raise exception 'This customer has no Australian mobile number.'; end if;
    if public.sms_used_this_month(p_business)
       + public.sms_part_count(public.sms_final_body((select nullif(trim(s.data ->> 'businessName'), '') from public.settings s where s.business_id = p_business and s.id = 'settings'), 'message', p_body))
       > public.plan_sms_allowance(plan) then
      raise exception '%', case when public.plan_sms_allowance(plan) = 0
        then 'Texts from Spannr are on the Pro plan and up. Send it from your own phone instead, or upgrade.'
        else 'You''ve used this month''s texts for your plan. Send it from your own phone instead, or upgrade.' end;
    end if;
  else
    addr := nullif(trim(coalesce(cust ->> 'email', '')), '');
    if addr is null then raise exception 'This customer has no email address.'; end if;
  end if;

  insert into public.notifications (business_id, job_id, kind, channel, booking_at, to_address, subject, body)
  values (p_business, coalesce(nullif(p_job, ''), 'customer:' || p_customer), 'message', p_channel, clock_timestamp(), addr,
          nullif(trim(coalesce(p_subject, '')), ''), trim(p_body))
  returning id into nid;

  perform public.send_notifications();  -- send straight away rather than waiting for the next minute
  return jsonb_build_object('id', nid, 'to', addr);
end $$;
