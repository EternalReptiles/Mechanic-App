-- Push the business the moment a customer approves/declines a quote, signs off a finished job,
-- or answers a video walk-around – so they can book it in straight away.
create or replace function public.push_customer_response() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who text := coalesce(nullif(split_part(trim(coalesce(new.signed_name, '')), ' ', 1), ''), 'Your customer');
  amt text := '$' || to_char(coalesce(new.approved_total, 0), 'FM999,990.00');
  outcome text := coalesce(new.decisions ->> 'outcome', '');
  title text;
  body text;
begin
  if old.responded_at is not null or new.responded_at is null then return null; end if;
  if new.kind = 'quote' then
    title := case outcome when 'declined' then 'Quote declined' when 'partial' then 'Quote partly approved' else 'Quote approved' end;
    body := case outcome
      when 'declined' then who || ' declined the quote' || coalesce(': ' || nullif(new.decisions ->> 'reason', ''), '.')
      when 'partial' then who || ' approved some of the repairs (' || amt || '). Open the job to book it in.'
      else who || ' approved the quote (' || amt || '). Open the job to book it in.' end;
  elsif new.kind = 'completion' then
    title := 'Job signed off';
    body := who || ' signed off the finished job (' || amt || ').';
  else
    title := 'Walk-around answered';
    body := who || ' responded to your video' || case when coalesce(new.approved_total, 0) > 0 then ' – approved ' || amt || ' of work.' else '.' end;
  end if;
  perform public.push_to_business(new.business_id, title, body, '/jobs/' || new.job_id, false);
  return null;
end $$;

drop trigger if exists push_customer_response on public.walkarounds;
create trigger push_customer_response after update of responded_at on public.walkarounds
  for each row execute function public.push_customer_response();
