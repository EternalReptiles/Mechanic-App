-- Track what each text really costs (ClickSend bills per 160-character part) and warn owners
-- before their monthly text allowance runs out, so automatic reminders don't stop without them knowing.
alter table public.notifications add column if not exists sms_parts int;
alter table public.notifications add column if not exists sms_cost numeric(10,4);
alter table public.businesses add column if not exists sms_alert_month text;
alter table public.businesses add column if not exists sms_alert_level int;

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
      update public.notifications set status = 'sent', sent_at = now(), error = null,
        sms_parts = case when m.channel = 'sms' then nullif((resp.content::jsonb) -> 'data' -> 'messages' -> 0 ->> 'message_parts', '')::int end,
        sms_cost = case when m.channel = 'sms' then nullif((resp.content::jsonb) -> 'data' -> 'messages' -> 0 ->> 'message_price', '')::numeric end
      where id = m.id;
    else
      update public.notifications set status = 'failed',
        error = left(coalesce(resp.error_msg, 'HTTP ' || resp.status_code || ': ' || coalesce(resp.content, '')), 300)
      where id = m.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;


create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_spannr_admin() then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
      select b.id, b.name, b.created_at, b.trial_ends_at, b.plan, b.plan_status, b.plan_interval, b.current_period_end,
        b.cancel_at_period_end, b.complimentary, b.closed_at,
        public.business_plan(b.id) as effective,
        (select m.email from public.members m where m.business_id = b.id and m.role = 'owner' limit 1) as owner_email,
        (select count(*) from public.members m where m.business_id = b.id) as users,
        (select count(*) from public.jobs j where j.business_id = b.id and not j.deleted) as jobs,
        (select count(*) from public.customers c where c.business_id = b.id and not c.deleted) as customers,
        (select max(j.server_ts) from public.jobs j where j.business_id = b.id) as last_activity,
        public.sms_used_this_month(b.id) as sms_used,
        public.plan_sms_allowance(public.business_plan(b.id)) as sms_allowance,
        (select coalesce(sum(n.sms_parts), 0) from public.notifications n where n.business_id = b.id and n.channel = 'sms' and n.status = 'sent'
           and n.created_at >= date_trunc('month', now() at time zone 'Australia/Sydney') at time zone 'Australia/Sydney') as sms_parts,
        (select coalesce(sum(n.sms_cost), 0) from public.notifications n where n.business_id = b.id and n.channel = 'sms' and n.status = 'sent'
           and n.created_at >= date_trunc('month', now() at time zone 'Australia/Sydney') at time zone 'Australia/Sydney') as sms_cost,
        (select count(*) from public.notifications n where n.business_id = b.id and n.channel = 'email' and n.status in ('sent', 'sending')
           and n.created_at >= date_trunc('month', now())) as emails_month,
        (select s.card_payments_status from public.stripe_accounts s where s.business_id = b.id) as card_payments,
        (select s.data ->> 'businessType' from public.settings s where s.business_id = b.id and s.id = 'settings') as business_type
      from public.businesses b
    ) x), '[]'::jsonb);
end $$;

-- Push the owner/admins at 80% and 100% of the month's texts (once each per month).
create or replace function public.sms_allowance_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  allow int; used int; lvl int;
  mon text := to_char(now() at time zone 'Australia/Sydney', 'YYYY-MM');
  b record;
begin
  if new.channel <> 'sms' or new.status not in ('queued', 'sending', 'sent') then return null; end if;
  allow := public.plan_sms_allowance(public.business_plan(new.business_id));
  if allow <= 0 then return null; end if;
  used := public.sms_used_this_month(new.business_id);
  lvl := case when used >= allow then 100 when used * 5 >= allow * 4 then 80 else 0 end;
  if lvl = 0 then return null; end if;
  select sms_alert_month, sms_alert_level into b from public.businesses where id = new.business_id for update;
  if b.sms_alert_month = mon and coalesce(b.sms_alert_level, 0) >= lvl then return null; end if;
  update public.businesses set sms_alert_month = mon, sms_alert_level = lvl where id = new.business_id;
  perform public.push_to_business(new.business_id,
    case when lvl = 100 then 'Texts used up for this month' else 'Texts running low' end,
    case when lvl = 100 then 'You''ve used all ' || allow || ' texts on your plan. Automatic reminders won''t send until the 1st – upgrade in Settings to keep them going.'
         else 'You''ve used ' || used || ' of ' || allow || ' texts this month.' end,
    '/settings?s=messages');
  return null;
end $$;
drop trigger if exists sms_allowance_alert on public.notifications;
create trigger sms_allowance_alert after insert on public.notifications
  for each row execute function public.sms_allowance_alert();
