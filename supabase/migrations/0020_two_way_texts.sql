-- Two-way texts: customer replies to Spannr texts come back into the app (ClickSend inbound rule → sms-inbound function).

create table if not exists public.sms_inbound (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  customer_id text,
  job_id text,
  notification_id uuid,
  from_number text not null,
  body text not null,
  provider_id text unique,
  received_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists sms_inbound_biz on public.sms_inbound (business_id, received_at desc);
create index if not exists sms_inbound_from on public.sms_inbound (business_id, from_number);
alter table public.sms_inbound enable row level security;
drop policy if exists "members read" on public.sms_inbound;
create policy "members read" on public.sms_inbound for select to authenticated using (public.is_member(business_id));
grant select on public.sms_inbound to authenticated;
grant all on public.sms_inbound to service_role;

-- Outgoing texts carry the notification id so a reply can be matched to it.
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

-- Called by the sms-inbound function for each reply. Matches it to the business (by the original text,
-- else the latest text sent to that number), files it against the customer/job, and emails the business.
create or replace function public.receive_sms(p_from text, p_body text, p_custom text, p_provider_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  num text := coalesce(public.au_mobile(p_from), p_from);
  n_id uuid;
  n_biz uuid;
  n_job text;
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
    select id, business_id, job_id into n_id, n_biz, n_job from public.notifications where id = p_custom::uuid;
  end if;
  if n_id is null then
    select id, business_id, job_id into n_id, n_biz, n_job from public.notifications
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

  -- Let the business know straight away.
  if n_biz is not null then
    select data into st from public.settings where business_id = n_biz and id = 'settings';
    biz := coalesce(nullif(st ->> 'businessName', ''), 'your business');
    alert_to := coalesce(nullif(trim(st ->> 'email'), ''),
      (select m.email from public.members m where m.business_id = n_biz and m.role = 'owner' limit 1));
    who := coalesce(nullif(c_name, ''), regexp_replace(num, '^\+61', '0'));
    perform public.send_spannr_email(alert_to, 'New text from ' || who,
      public.spannr_email_html('💬 ' || public.html_escape(who) || ' replied',
        '<p style="font-size:16px;background:#f4f4f5;border-radius:10px;padding:14px 16px">' || replace(public.html_escape(trim(p_body)), E'\n', '<br>') || '</p>'
        || '<p>Reply from the customer''s page or job in Spannr – the message goes from ' || public.html_escape(biz) || '.</p>'
        || '<p style="margin:20px 0"><a href="https://app.spannr.au/messages" style="display:inline-block;background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Open messages</a></p>'),
      who || ' replied: ' || trim(p_body) || E'\n\nOpen Spannr to reply: https://app.spannr.au/messages');
  end if;
  return id_;
end $$;
revoke execute on function public.receive_sms(text, text, text, text) from public, anon, authenticated;
grant execute on function public.receive_sms(text, text, text, text) to service_role;

-- The text conversation with one customer (sent and received), oldest first.
create or replace function public.customer_thread(bid uuid, p_customer text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare num text;
begin
  if not public.is_member(bid) then raise exception 'Not a member of this business'; end if;
  select public.au_mobile(c.data ->> 'phone') into num from public.customers c where c.business_id = bid and c.id = p_customer;
  return coalesce((
    select jsonb_agg(t order by t.at) from (
      select 'out' as dir, n.body, n.created_at as at, n.kind, n.status, null::timestamptz as read_at, n.id::text as id
        from public.notifications n where n.business_id = bid and n.channel = 'sms' and (n.to_address = num)
          and n.status <> 'skipped'
      union all
      select 'in', s.body, s.received_at, 'reply', 'received', s.read_at, s.id::text
        from public.sms_inbound s where s.business_id = bid and (s.customer_id = p_customer or (num is not null and s.from_number = num))
    ) t), '[]'::jsonb);
end $$;
grant execute on function public.customer_thread(uuid, text) to authenticated;

-- Latest conversations for the Messages screen.
create or replace function public.message_inbox(bid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_member(bid) then raise exception 'Not a member of this business'; end if;
  return coalesce((
    select jsonb_agg(x order by x.last_at desc) from (
      select s.from_number, max(s.customer_id) as customer_id,
        (array_agg(s.job_id order by s.received_at desc))[1] as job_id,
        (array_agg(s.body order by s.received_at desc))[1] as last_body,
        max(s.received_at) as last_at, count(*) filter (where s.read_at is null) as unread
      from public.sms_inbound s where s.business_id = bid
      group by s.from_number
      order by max(s.received_at) desc limit 100
    ) x), '[]'::jsonb);
end $$;
grant execute on function public.message_inbox(uuid) to authenticated;

create or replace function public.unread_replies(bid uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case when public.is_member(bid) then (select count(*)::int from public.sms_inbound where business_id = bid and read_at is null) else 0 end
$$;
grant execute on function public.unread_replies(uuid) to authenticated;

create or replace function public.mark_replies_read(bid uuid, p_from text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(bid) then raise exception 'Not a member of this business'; end if;
  update public.sms_inbound set read_at = now() where business_id = bid and from_number = p_from and read_at is null;
end $$;
grant execute on function public.mark_replies_read(uuid, text) to authenticated;

create or replace function public.mark_customer_replies_read(bid uuid, p_customer text) returns void
language plpgsql security definer set search_path = '' as $$
declare num text;
begin
  if not public.is_member(bid) then raise exception 'Not a member of this business'; end if;
  select public.au_mobile(c.data ->> 'phone') into num from public.customers c where c.business_id = bid and c.id = p_customer;
  update public.sms_inbound set read_at = now()
   where business_id = bid and read_at is null and (customer_id = p_customer or (num is not null and from_number = num));
end $$;
grant execute on function public.mark_customer_replies_read(uuid, text) to authenticated;
