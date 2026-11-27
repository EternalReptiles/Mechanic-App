-- Welcome emails from Spannr: to the owner when a business is created, and to team members when they join.

create or replace function public.html_escape(t text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

-- Spannr-branded email wrapper (for Spannr's own emails, not a business's).
create or replace function public.spannr_email_html(title text, inner_html text) returns text
language sql immutable set search_path = '' as $$
  select '<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">'
    || '<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">'
    || '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">'
    || '<tr><td style="background:#0f172a;padding:20px 28px;color:#f59e0b;font-size:22px;font-weight:800">Spannr</td></tr>'
    || '<tr><td style="padding:28px 28px 8px"><h1 style="margin:0 0 12px;font-size:22px;color:#0f172a">' || title || '</h1></td></tr>'
    || '<tr><td style="padding:0 28px 24px;font-size:15px;line-height:1.6;color:#27272a">' || inner_html || '</td></tr>'
    || '<tr><td style="padding:16px 28px;border-top:1px solid #e4e4e7;font-size:13px;color:#71717a">'
    || 'Need a hand? Just reply to this email or write to <a href="mailto:hello@spannr.au" style="color:#b45309">hello@spannr.au</a>.<br>'
    || '<a href="https://spannr.au" style="color:#b45309">spannr.au</a> · <a href="https://spannr.au/terms" style="color:#71717a">Terms</a> · <a href="https://spannr.au/privacy" style="color:#71717a">Privacy</a></td></tr>'
    || '</table><p style="font-size:12px;color:#a1a1aa;margin:16px 0 0">Spannr · job management for mechanics · Made in Australia</p>'
    || '</td></tr></table></body></html>'
$$;

-- Sends one email from Spannr through Resend (fire-and-forget; skipped if email isn't set up).
create or replace function public.send_spannr_email(to_address text, subject text, html text, text_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  rs_key text := public.notify_secret('resend_api_key');
begin
  if coalesce(rs_key, '') = '' or coalesce(to_address, '') = '' then return; end if;
  -- Never email placeholder/test addresses.
  if lower(to_address) ~ '@(example\.(com|org|net)|[a-z0-9.-]+\.(test|invalid|localhost))$' then return; end if;
  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || rs_key),
    body := jsonb_build_object(
      'from', 'Spannr <hello@spannr.au>',
      'reply_to', 'hello@spannr.au',
      'to', jsonb_build_array(to_address),
      'subject', subject,
      'html', html,
      'text', text_body),
    timeout_milliseconds := 15000);
end $$;
revoke execute on function public.send_spannr_email(text, text, text, text) from public, anon, authenticated;

create or replace function public.send_welcome(p_business uuid, p_email text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  biz text;
  trial timestamptz;
  btn text := '<p style="margin:20px 0"><a href="https://app.spannr.au" style="display:inline-block;background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Open Spannr</a></p>';
  body_html text;
begin
  if coalesce(p_email, '') = '' then return; end if;
  select b.name, b.trial_ends_at into biz, trial from public.businesses b where b.id = p_business;

  if p_role = 'owner' then
    body_html :=
      '<p>Thanks for signing up – <strong>' || public.html_escape(biz) || '</strong> is ready to go.</p>'
      || '<p>Your <strong>30-day free trial</strong> has started' || coalesce(' and runs until <strong>' || to_char(trial at time zone 'Australia/Sydney', 'FMDD Mon YYYY') || '</strong>', '')
      || '. Everything is unlocked, and there''s no card needed.</p>'
      || btn
      || '<p style="margin-bottom:6px"><strong>Get set up in about 10 minutes:</strong></p>'
      || '<ol style="margin:0 0 16px;padding-left:20px">'
      || '<li><strong>Your business details</strong> – Settings → add your ABN, logo, brand colour and bank details so they appear on quotes and invoices.</li>'
      || '<li><strong>Your price list</strong> – Settings → Price list: add your labour rate, common parts and services.</li>'
      || '<li><strong>Card payments</strong> – Settings → Card payments: connect Stripe so customers can pay by card, Apple Pay or Google Pay.</li>'
      || '<li><strong>Automatic messages</strong> – Settings → Automatic messages: turn on booking confirmations and reminders.</li>'
      || '<li><strong>Your team</strong> – Settings → Team: invite your technicians. They get their own simple app with just their jobs.</li>'
      || '<li><strong>On your phone</strong> – open app.spannr.au and tap Share → Add to Home Screen, so Spannr opens like an app.</li>'
      || '</ol>'
      || '<p>Then try your first job: <strong>+ New job</strong> → add the customer and car → book it in → add labour and parts → send the quote or invoice.</p>'
      || '<p>Questions, ideas or something not working? Reply to this email – it comes straight to us, and we''re happy to help you get set up.</p>'
      || '<p>Cheers,<br>The Spannr team</p>';
    perform public.send_spannr_email(p_email, 'Welcome to Spannr – let''s get you set up',
      public.spannr_email_html('Welcome to Spannr', body_html),
      'Welcome to Spannr! ' || coalesce(biz, 'Your business') || ' is ready. Your 30-day free trial has started. Open Spannr: https://app.spannr.au'
      || E'\n\nGet set up: 1) Settings → business details, ABN, logo. 2) Price list. 3) Card payments. 4) Automatic messages. 5) Invite your team. 6) Add Spannr to your phone home screen.'
      || E'\n\nNeed a hand? Reply to this email or write to hello@spannr.au.');
  else
    body_html :=
      '<p>You''ve joined <strong>' || public.html_escape(biz) || '</strong> on Spannr' || case when p_role = 'admin' then ' as an admin' else '' end || '.</p>'
      || case when p_role = 'tech' then
           '<p>Your Spannr shows <strong>the jobs assigned to you</strong>, with everything you need to do them: the customer and car, the address, the checklist to fill in, and photos. When you''re done, tap <strong>Mark job finished</strong> and the office takes it from there.</p>'
         else
           '<p>You can see and manage the business''s jobs, customers, schedule and invoices.</p>'
         end
      || btn
      || '<p><strong>Tip:</strong> on your phone, open app.spannr.au and tap Share → <strong>Add to Home Screen</strong>, so Spannr opens like an app.</p>'
      || '<p>Cheers,<br>The Spannr team</p>';
    perform public.send_spannr_email(p_email, 'You''ve joined ' || coalesce(biz, 'your team') || ' on Spannr',
      public.spannr_email_html('Welcome to the team', body_html),
      'You''ve joined ' || coalesce(biz, 'your team') || ' on Spannr. Open it at https://app.spannr.au');
  end if;
end $$;
revoke execute on function public.send_welcome(uuid, text, text) from public, anon, authenticated;

create or replace function public.welcome_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.send_welcome(new.business_id, new.email, new.role);
  return new;
exception when others then
  -- Never block sign-up because of an email problem.
  return new;
end $$;

drop trigger if exists welcome_member on public.members;
create trigger welcome_member after insert on public.members for each row execute function public.welcome_member();
