-- Texts and emails the mechanic sends from the app (quotes, walk-arounds, sign-offs, invoices, "on my way",
-- "car's ready", reminders) now go out from Spannr: SMS via ClickSend, email via Resend in the business's branding.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('confirmation', 'reminder', 'receipt', 'message'));

-- Texts this business has used this calendar month (Sydney time) against its plan's allowance.
create or replace function public.sms_used_this_month(bid uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.notifications x
  where x.business_id = bid and x.channel = 'sms' and x.status in ('queued', 'sent', 'sending')
    and x.created_at >= date_trunc('month', now() at time zone 'Australia/Sydney') at time zone 'Australia/Sydney'
$$;

-- What the app shows next to the "Send" buttons.
create or replace function public.message_allowance(bid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  plan text;
  allowance int;
begin
  if not public.is_member(bid) then raise exception 'Not a member of this business'; end if;
  plan := public.business_plan(bid);
  allowance := public.plan_sms_allowance(plan);
  return jsonb_build_object(
    'plan', plan,
    'sms_allowance', allowance,
    'sms_used', public.sms_used_this_month(bid),
    'sms_ready', exists (select 1 from vault.decrypted_secrets where name = 'clicksend_api_key' and coalesce(decrypted_secret, '') <> ''),
    'email_ready', exists (select 1 from vault.decrypted_secrets where name = 'resend_api_key' and coalesce(decrypted_secret, '') <> ''));
end $$;
grant execute on function public.message_allowance(uuid) to authenticated;

-- Sends a message to one of the business's own customers (the address comes from the customer record,
-- so this can't be used to message arbitrary numbers).
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
    if public.sms_used_this_month(p_business) >= public.plan_sms_allowance(plan) then
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
grant execute on function public.send_customer_message(uuid, text, text, text, text, text) to authenticated;

-- Make links in branded emails clickable.
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
    || '<p style="font-size:12px;color:#a1a1aa;margin:16px 0 0">Sent with <strong style="color:#f59e0b">Spannr</strong> &middot; job management for mechanics</p>'
    || '</td></tr></table></body></html>';
end $$;
