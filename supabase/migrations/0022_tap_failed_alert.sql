-- Apple 5.12: if a Tap to Pay payment isn't approved (e.g. the app was closed before the result showed),
-- the business is told by email.
create or replace function public.notify_tap_failed(p_business uuid, p_job text, p_amount int, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  st jsonb;
  biz text;
  to_ text;
  num text;
  amt text := '$' || to_char(coalesce(p_amount, 0) / 100.0, 'FM999,990.00');
begin
  select data into st from public.settings where business_id = p_business and id = 'settings';
  biz := coalesce(nullif(st ->> 'businessName', ''), 'your business');
  to_ := coalesce(nullif(trim(st ->> 'email'), ''), (select m.email from public.members m where m.business_id = p_business and m.role = 'owner' limit 1));
  select j.data ->> 'number' into num from public.jobs j where j.business_id = p_business and j.id = p_job;
  perform public.send_spannr_email(to_, 'Tap to Pay payment not approved – ' || amt,
    public.spannr_email_html('Payment not approved',
      '<p>A Tap to Pay on iPhone payment of <strong>' || amt || '</strong>' || coalesce(' for job <strong>#' || num || '</strong>', '')
      || ' was <strong>not approved</strong>' || coalesce(' (' || public.html_escape(p_reason) || ')', '') || '. No money was taken.</p>'
      || '<p>Open the job in Spannr to try again, or send the customer a pay link.</p>'
      || '<p style="margin:20px 0"><a href="https://app.spannr.au/jobs/' || p_job || '?tab=billing" style="display:inline-block;background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Open the job</a></p>'),
    'A Tap to Pay payment of ' || amt || coalesce(' for job #' || num, '') || ' at ' || biz || ' was not approved. No money was taken.');
end $$;
revoke execute on function public.notify_tap_failed(uuid, text, int, text) from public, anon, authenticated;
grant execute on function public.notify_tap_failed(uuid, text, int, text) to service_role;
