-- ClickSend credit watch. Spannr's one ClickSend account pays for every business's texts, so when its credit runs
-- low (or a text fails for lack of credit) Spannr admins get a push + email, and a red banner in the app.
-- Only Spannr admins ever see this – never the mechanics using Spannr.

create table if not exists public.platform_status (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.platform_status enable row level security;  -- no policies: read through spannr_alerts()

-- Below this (in your ClickSend account's currency) the alert goes out.
create or replace function public.clicksend_low_threshold() returns numeric language sql immutable as $$ select 10::numeric $$;

-- Runs every 15 minutes: reads the last balance request's answer, asks ClickSend again, and alerts when low.
create or replace function public.check_clicksend_credit() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  st jsonb;
  resp record;
  bal numeric;
  cur text;
  failed int;
  low boolean;
  req bigint;
  cs_user text := public.notify_secret('clicksend_username');
  cs_key text := public.notify_secret('clicksend_api_key');
  a record;
  msg text;
begin
  if coalesce(cs_user, '') = '' or coalesce(cs_key, '') = '' then return null; end if;
  select value into st from public.platform_status where key = 'clicksend';
  st := coalesce(st, '{}'::jsonb);

  -- 1) The answer to last time's request.
  if (st ->> 'request_id') is not null then
    select status_code, content into resp from net._http_response where id = (st ->> 'request_id')::bigint;
    if found and resp.status_code = 200 then
      bal := nullif((resp.content::jsonb) -> 'data' ->> 'balance', '')::numeric;
      cur := (resp.content::jsonb) -> 'data' -> '_currency' ->> 'currency_name_short';
      if bal is not null then
        st := st || jsonb_build_object('balance', round(bal, 2), 'currency', coalesce(cur, st ->> 'currency', 'AUD'), 'checked_at', now());
      end if;
    end if;
  end if;

  -- Texts that failed for lack of credit in the last 24 hours.
  -- (ignoring ones from before the last text that went through – i.e. it's been topped up since)
  select count(*) into failed from public.notifications f
   where f.channel = 'sms' and f.status = 'failed' and f.error ilike '%INSUFFICIENT_CREDIT%' and f.created_at > now() - interval '24 hours'
     and not exists (select 1 from public.notifications ok where ok.channel = 'sms' and ok.status = 'sent' and ok.created_at > f.created_at);
  st := st || jsonb_build_object('failed_credit_24h', failed);
  low := (st ->> 'balance') is not null and (st ->> 'balance')::numeric < public.clicksend_low_threshold();
  st := st || jsonb_build_object('low', low or failed > 0);

  -- 2) Alert Spannr admins (at most once every 12 hours while it stays low).
  if (low or failed > 0) and coalesce((st ->> 'alerted_at')::timestamptz, 'epoch') < now() - interval '12 hours' then
    msg := case when failed > 0 then failed || ' text' || case when failed = 1 then '' else 's' end || ' failed – ClickSend is out of credit.'
                else 'ClickSend credit is down to $' || to_char((st ->> 'balance')::numeric, 'FM9990.00') || '.' end
           || ' Top up so customer texts keep going out.';
    for a in select u.email, m.business_id from public.spannr_admins s join auth.users u on u.id = s.user_id
             left join public.members m on m.user_id = s.user_id loop
      if a.business_id is not null then
        perform public.push_to_business(a.business_id, 'ClickSend credit low', msg, '/admin', true);
      end if;
    end loop;
    for a in select distinct u.email from public.spannr_admins s join auth.users u on u.id = s.user_id loop
      perform public.send_spannr_email(a.email, 'Spannr: ClickSend credit low',
        '<p>' || msg || '</p><p><a href="https://dashboard.clicksend.com/">Top up ClickSend</a> (Billing → Recharge). Turning on auto top-up stops this happening again.</p>',
        msg || E'\n\nTop up: https://dashboard.clicksend.com/');
    end loop;
    st := st || jsonb_build_object('alerted_at', now());
  elsif not (low or failed > 0) then
    st := st - 'alerted_at';  -- back to normal: alert again next time it runs low
  end if;

  -- 3) Ask again (the answer is read next run).
  select net.http_get(
    url := 'https://rest.clicksend.com/v3/account',
    headers := jsonb_build_object('Authorization', 'Basic ' || replace(encode(convert_to(cs_user || ':' || cs_key, 'UTF8'), 'base64'), E'\n', '')),
    timeout_milliseconds := 15000) into req;
  st := st || jsonb_build_object('request_id', req);

  insert into public.platform_status (key, value, updated_at) values ('clicksend', st, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return st - 'request_id';
end $$;
revoke execute on function public.check_clicksend_credit() from public, anon, authenticated;

-- What the app shows Spannr admins (null for everyone else).
create or replace function public.spannr_alerts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_spannr_admin() then return null; end if;
  return (select jsonb_build_object('clicksend', value - 'request_id' - 'alerted_at', 'threshold', public.clicksend_low_threshold())
            from public.platform_status where key = 'clicksend');
end $$;
grant execute on function public.spannr_alerts() to authenticated;

select cron.unschedule('spannr-clicksend-credit') where exists (select 1 from cron.job where jobname = 'spannr-clicksend-credit');
select cron.schedule('spannr-clicksend-credit', '*/15 * * * *', 'select public.check_clicksend_credit()');
