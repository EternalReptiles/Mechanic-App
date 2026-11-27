-- Emails from Spannr as a free trial runs out (7 days and 1 day before), with an optional sign-up offer.
-- The offer is set in public.spannr_config:  trial_offer_code (a Stripe promotion code) and trial_offer_text.

create table if not exists public.spannr_config (key text primary key, value text not null);
alter table public.spannr_config enable row level security;  -- no policies: server only
grant all on public.spannr_config to service_role;

alter table public.businesses add column if not exists trial_email_7d_at timestamptz;
alter table public.businesses add column if not exists trial_email_1d_at timestamptz;

create or replace function public.send_trial_reminder(p_business uuid, p_days int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b record;
  owner_email text;
  code text := (select value from public.spannr_config where key = 'trial_offer_code');
  offer text := (select value from public.spannr_config where key = 'trial_offer_text');
  link text;
  body_html text;
  ends text;
begin
  select * into b from public.businesses where id = p_business;
  select m.email into owner_email from public.members m where m.business_id = p_business and m.role = 'owner' limit 1;
  if owner_email is null then return; end if;
  link := 'https://app.spannr.au/settings/billing' || case when coalesce(code, '') <> '' then '?promo=' || code else '' end;
  ends := to_char(b.trial_ends_at at time zone 'Australia/Sydney', 'FMDay FMDD Mon');

  body_html :=
    '<p>Your free Spannr trial for <strong>' || public.html_escape(b.name) || '</strong> ends '
    || case when p_days <= 1 then '<strong>tomorrow</strong>' else 'on <strong>' || ends || '</strong>' end || '.</p>'
    || '<p>Choose a plan to keep creating jobs, sending quotes and invoices, and taking card payments. Your customers, jobs and settings all stay exactly as they are.</p>'
    || case when coalesce(code, '') <> '' and coalesce(offer, '') <> '' then
         '<div style="background:#fef3c7;border-radius:10px;padding:14px 16px;margin:16px 0"><strong>🎁 ' || public.html_escape(offer)
         || '</strong><br>Use code <strong style="font-family:monospace;font-size:16px">' || public.html_escape(upper(code)) || '</strong> – it''s applied automatically from the button below.</div>'
       else '' end
    || '<p style="margin:20px 0"><a href="' || link || '" style="display:inline-block;background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Choose my plan</a></p>'
    || '<p style="margin-bottom:6px"><strong>Plans</strong> (one price per business, plus GST):</p>'
    || '<ul style="margin:0 0 16px;padding-left:20px">'
    || '<li><strong>Solo</strong> $39/month – 1 user</li>'
    || '<li><strong>Pro</strong> $65/month – up to 3 users, remote sign-offs, video walk-arounds, automatic texts</li>'
    || '<li><strong>Team</strong> $95/month – up to 8 users, workshop board, Tap to Pay on iPhone</li>'
    || '<li><strong>Business</strong> $149/month – unlimited users, priority support</li></ul>'
    || '<p>Pay yearly and get 2 months free. Cancel any time.</p>'
    || '<p>Not sure which plan suits you, or need a bit longer to try it? Just reply – we''re happy to help.</p>'
    || '<p>Cheers,<br>The Spannr team</p>';

  perform public.send_spannr_email(owner_email,
    case when p_days <= 1 then 'Your Spannr trial ends tomorrow' else 'Your Spannr trial ends in ' || p_days || ' days' end
      || case when coalesce(code, '') <> '' and coalesce(offer, '') <> '' then ' – plus an offer for you' else '' end,
    public.spannr_email_html(case when p_days <= 1 then 'Your trial ends tomorrow' else 'Your trial ends in ' || p_days || ' days' end, body_html),
    'Your Spannr trial for ' || coalesce(b.name, 'your business') || ' ends ' || case when p_days <= 1 then 'tomorrow' else 'on ' || ends end || '. '
      || case when coalesce(code, '') <> '' and coalesce(offer, '') <> '' then offer || ' – use code ' || upper(code) || '. ' else '' end
      || 'Choose a plan: ' || link);
end $$;
revoke execute on function public.send_trial_reminder(uuid, int) from public, anon, authenticated;

-- Runs hourly: businesses still on their trial (no subscription) get one email at 7 days and one at 1 day.
create or replace function public.trial_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select id, trial_ends_at from public.businesses
    where plan is null and trial_ends_at > now() and trial_ends_at <= now() + interval '7 days'
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

select cron.unschedule('spannr-trial-reminders') where exists (select 1 from cron.job where jobname = 'spannr-trial-reminders');
select cron.schedule('spannr-trial-reminders', '23 * * * *', 'select public.trial_reminders()');
