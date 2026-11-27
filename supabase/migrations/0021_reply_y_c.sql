-- Booking texts end with "Reply Y to confirm or C to cancel"; Y/C replies update the job and get an automatic reply.

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
      if m.kind in ('confirmation', 'reminder') then sms_body := sms_body || E'\nReply Y to confirm or C to cancel.'; end if;
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

create or replace function public.receive_sms(p_from text, p_body text, p_custom text, p_provider_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  num text := coalesce(public.au_mobile(p_from), p_from);
  n_id uuid;
  n_biz uuid;
  n_job text;
  n_kind text;
  n_at timestamptz;
  answer text;
  tz text;
  first text;
  c_id text;
  c_name text;
  st jsonb;
  biz text;
  alert_to text;
  id_ uuid;
  who text;
begin
  if coalesce(trim(p_body), '') = '' then return null; end if;
  if coalesce(p_provider_id, '') <> '' and exists (select 1 from public.sms_inbound where provider_id = p_provider_id) then return null; end if;

  if coalesce(p_custom, '') ~ '^[0-9a-f-]{36}$' then
    select id, business_id, job_id, kind, booking_at into n_id, n_biz, n_job, n_kind, n_at from public.notifications where id = p_custom::uuid;
  end if;
  if n_id is null then
    select id, business_id, job_id, kind, booking_at into n_id, n_biz, n_job, n_kind, n_at from public.notifications
      where channel = 'sms' and to_address = num and created_at > now() - interval '90 days'
      order by created_at desc limit 1;
  end if;

  if n_biz is not null then
    select c.id, c.data ->> 'name' into c_id, c_name from public.customers c
      where c.business_id = n_biz and not c.deleted and public.au_mobile(c.data ->> 'phone') = num
      order by c.server_ts desc limit 1;
  end if;

  insert into public.sms_inbound (business_id, customer_id, job_id, notification_id, from_number, body, provider_id)
  values (n_biz, c_id, case when n_job like 'customer:%' or n_job like 'vehicle:%' then null else n_job end,
          n_id, num, trim(p_body), nullif(p_provider_id, ''))
  returning id into id_;

  -- "Y" / "C" replies to a booking confirmation or reminder.
  if n_biz is not null and n_kind in ('confirmation', 'reminder') and n_job is not null then
    answer := case
      when lower(trim(p_body)) ~ '^(y|yes|yep|yeah|yes please|confirm|confirmed|ok|okay|👍)[\s.!]*$' then 'confirmed'
      when lower(trim(p_body)) ~ '^(c|cancel|n|no|cancel please)[\s.!]*$' then 'cancel'
      else null end;
    if answer is not null then
      update public.jobs set
        data = data || jsonb_build_object('customerReply', jsonb_build_object('answer', answer, 'at', now())),
        updated_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
      where business_id = n_biz and id = n_job;
      select data into st from public.settings where business_id = n_biz and id = 'settings';
      biz := coalesce(nullif(st ->> 'businessName', ''), 'us');
      tz := coalesce(nullif(st ->> 'timezone', ''), 'Australia/Sydney');
      first := coalesce(nullif(split_part(trim(c_name), ' ', 1), ''), 'there');
      -- Text back to confirm we got it.
      insert into public.notifications (business_id, job_id, kind, channel, booking_at, to_address, body)
      values (n_biz, n_job, 'message', 'sms', clock_timestamp(), num,
        case when answer = 'confirmed'
          then 'Thanks ' || first || ', you''re confirmed' || coalesce(' for ' || to_char(n_at at time zone tz, 'FMDay FMDD Mon "at" FMHH12:MIam'), '') || '. See you then!'
          else 'Thanks ' || first || ', we''ve let ' || biz || ' know and they''ll be in touch to sort out a new time.' end);
      perform public.send_notifications();
      if answer = 'confirmed' then
        -- A simple "Y" doesn't need anyone's attention.
        update public.sms_inbound set read_at = now() where id = id_;
        return id_;
      end if;
    end if;
  end if;

  -- Let the business know straight away.
  if n_biz is not null then
    select data into st from public.settings where business_id = n_biz and id = 'settings';
    biz := coalesce(nullif(st ->> 'businessName', ''), 'your business');
    alert_to := coalesce(nullif(trim(st ->> 'email'), ''),
      (select m.email from public.members m where m.business_id = n_biz and m.role = 'owner' limit 1));
    who := coalesce(nullif(c_name, ''), regexp_replace(num, '^\+61', '0'));
    perform public.send_spannr_email(alert_to, case when answer = 'cancel' then who || ' wants to cancel or change their booking' else 'New text from ' || who end,
      public.spannr_email_html('💬 ' || public.html_escape(who) || ' replied',
        '<p style="font-size:16px;background:#f4f4f5;border-radius:10px;padding:14px 16px">' || replace(public.html_escape(trim(p_body)), E'\n', '<br>') || '</p>'
        || '<p>Reply from the customer''s page or job in Spannr – the message goes from ' || public.html_escape(biz) || '.</p>'
        || '<p style="margin:20px 0"><a href="https://app.spannr.au/messages" style="display:inline-block;background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Open messages</a></p>'),
      who || ' replied: ' || trim(p_body) || E'\n\nOpen Spannr to reply: https://app.spannr.au/messages');
  end if;
  return id_;
end $$;
