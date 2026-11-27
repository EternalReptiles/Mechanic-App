-- Online booking: a public page per business (app.spannr.au/book/<slug>) where customers book themselves.
-- Settings live in settings.data.booking; the slug is unique on businesses.

alter table public.businesses add column if not exists booking_slug text unique;

create table if not exists public.booking_attempts (
  id bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  phone text,
  created_at timestamptz not null default now()
);
alter table public.booking_attempts enable row level security;
grant all on public.booking_attempts to service_role;
grant usage, select on sequence public.booking_attempts_id_seq to service_role;

-- Owner/admin sets the business's booking link.
create or replace function public.set_booking_slug(bid uuid, p_slug text) returns text
language plpgsql security definer set search_path = '' as $$
declare s text := lower(trim(coalesce(p_slug, '')));
begin
  if not public.is_admin(bid) then raise exception 'Only the owner or an admin can change the booking link.'; end if;
  s := regexp_replace(regexp_replace(s, '[^a-z0-9-]+', '-', 'g'), '(^-+|-+$)', '', 'g');
  if length(s) < 3 or length(s) > 40 then raise exception 'Use 3–40 letters, numbers or dashes.'; end if;
  if s in ('admin', 'app', 'api', 'book', 'spannr', 'www', 'help', 'support', 'login', 'settings') then raise exception 'That link is reserved – try another.'; end if;
  if exists (select 1 from public.businesses where booking_slug = s and id <> bid) then raise exception 'That link is already taken – try another.'; end if;
  update public.businesses set booking_slug = s where id = bid;
  return s;
end $$;
grant execute on function public.set_booking_slug(uuid, text) to authenticated;

create or replace function public.booking_business(p_slug text) returns uuid
language sql stable security definer set search_path = '' as $$
  select b.id from public.businesses b
  join public.settings s on s.business_id = b.id and s.id = 'settings'
  where b.booking_slug = lower(p_slug) and b.closed_at is null
    and public.business_plan(b.id) <> 'expired'
    and coalesce((s.data -> 'booking' ->> 'enabled')::boolean, false)
$$;

-- Everything the public booking page needs (no customer details): business, services, hours, busy times.
create or replace function public.public_booking_page(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  bid uuid := public.booking_business(p_slug);
  st jsonb;
  bk jsonb;
  gst boolean;
  services jsonb;
  busy jsonb;
  days int;
begin
  if bid is null then return null; end if;
  select data into st from public.settings where business_id = bid and id = 'settings';
  bk := st -> 'booking';
  gst := coalesce((st ->> 'gstRegistered')::boolean, true);
  days := least(greatest(coalesce((bk ->> 'maxDaysAhead')::int, 30), 1), 90);

  -- Services, with a "from" price worked out from the linked price-list item when the business shows prices.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', sv ->> 'id', 'name', sv ->> 'name', 'durationMins', coalesce((sv ->> 'durationMins')::int, 60),
      'description', sv ->> 'description',
      'price', case when coalesce((sv ->> 'showPrice')::boolean, false) then (
          select round(sum((l ->> 'qty')::numeric * (l ->> 'unitPrice')::numeric) * case when gst then 1.1 else 1 end, 2)
          from public.catalog c, jsonb_array_elements(c.data -> 'lines') l
          where c.business_id = bid and c.id = sv ->> 'catalogId' and not c.deleted) end)), '[]'::jsonb)
    into services from jsonb_array_elements(coalesce(bk -> 'services', '[]'::jsonb)) sv;

  select coalesce(jsonb_agg(jsonb_build_array(start_at, start_at + make_interval(mins => mins))), '[]'::jsonb) into busy from (
    select (j.data ->> 'scheduledStart')::timestamptz as start_at, greatest(coalesce((j.data ->> 'durationMins')::int, 60), 15) as mins
    from public.jobs j
    where j.business_id = bid and not j.deleted and coalesce(j.data ->> 'scheduledStart', '') <> ''
      and coalesce(j.data ->> 'status', '') not in ('cancelled')
      and (j.data ->> 'scheduledStart')::timestamptz between now() - interval '1 day' and now() + make_interval(days => days + 1)
  ) x;

  return jsonb_build_object(
    'businessName', coalesce(nullif(st ->> 'businessName', ''), 'Book a service'),
    'logo', nullif(st ->> 'logo', ''),
    'brandColor', st ->> 'brandColor',
    'phone', st ->> 'phone',
    'email', st ->> 'email',
    'businessType', coalesce(st ->> 'businessType', 'mobile'),
    'workshopAddress', case when coalesce(st ->> 'businessType', 'mobile') <> 'mobile' then st ->> 'address' end,
    'timezone', coalesce(nullif(st ->> 'timezone', ''), 'Australia/Sydney'),
    'intro', bk ->> 'intro',
    'services', services,
    'days', coalesce(bk -> 'days', '[1,2,3,4,5]'::jsonb),
    'startTime', coalesce(bk ->> 'startTime', '08:00'),
    'endTime', coalesce(bk ->> 'endTime', '17:00'),
    'slotMins', coalesce((bk ->> 'slotMins')::int, 30),
    'leadHours', coalesce((bk ->> 'leadHours')::int, 12),
    'maxDaysAhead', days,
    'capacity', greatest(coalesce((bk ->> 'capacity')::int, 1), 1),
    'busy', busy,
    'gst', gst);
end $$;
grant execute on function public.public_booking_page(text) to anon, authenticated;

-- Creates the booking: matches or adds the customer and vehicle, adds a scheduled job (with the service's
-- price-list lines), then tells the business. The automatic booking confirmation goes out as usual.
create or replace function public.public_create_booking(p_slug text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  bid uuid := public.booking_business(p_slug);
  st jsonb; bk jsonb; sv jsonb;
  tz text;
  start_at timestamptz;
  mins int;
  local_start timestamp; local_end timestamp;
  cap int;
  clash int;
  v_phone text := public.au_mobile(p ->> 'phone');
  name text := left(trim(coalesce(p ->> 'name', '')), 80);
  email text := left(lower(trim(coalesce(p ->> 'email', ''))), 120);
  rego text := upper(left(regexp_replace(coalesce(p ->> 'rego', ''), '\s+', '', 'g'), 12));
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  cust_id text; veh_id text; job_id text := gen_random_uuid()::text;
  num int;
  lines jsonb := '[]'::jsonb;
  biz_type text;
  addr text := left(trim(coalesce(p ->> 'address', '')), 200);
  when_txt text;
begin
  if bid is null then raise exception 'Online booking isn''t available for this business right now.'; end if;
  if coalesce(p ->> 'website', '') <> '' then raise exception 'Booking failed.'; end if; -- spam trap
  if name = '' then raise exception 'Please enter your name.'; end if;
  if v_phone is null then raise exception 'Please enter an Australian mobile number (04…).'; end if;

  -- Abuse limits: 3 bookings per phone per day, 60 per business per day.
  if (select count(*) from public.booking_attempts where business_id = bid and booking_attempts.phone = v_phone and created_at > now() - interval '1 day') >= 3
     or (select count(*) from public.booking_attempts where business_id = bid and created_at > now() - interval '1 day') >= 60 then
    raise exception 'Too many bookings – please call the business to book.';
  end if;

  select data into st from public.settings where business_id = bid and id = 'settings';
  bk := st -> 'booking';
  tz := coalesce(nullif(st ->> 'timezone', ''), 'Australia/Sydney');
  biz_type := coalesce(st ->> 'businessType', 'mobile');
  select x into sv from jsonb_array_elements(coalesce(bk -> 'services', '[]'::jsonb)) x where x ->> 'id' = p ->> 'serviceId';
  if sv is null then raise exception 'Please choose a service.'; end if;
  mins := greatest(coalesce((sv ->> 'durationMins')::int, 60), 15);
  start_at := (p ->> 'start')::timestamptz;
  if start_at < now() + make_interval(hours => coalesce((bk ->> 'leadHours')::int, 12)) then raise exception 'That time is too soon – please pick a later time.'; end if;
  if start_at > now() + make_interval(days => coalesce((bk ->> 'maxDaysAhead')::int, 30) + 1) then raise exception 'That date is too far ahead.'; end if;

  -- Within opening days and hours (business time zone).
  local_start := start_at at time zone tz;
  local_end := local_start + make_interval(mins => mins);
  if not (coalesce(bk -> 'days', '[1,2,3,4,5]'::jsonb) @> to_jsonb(extract(dow from local_start)::int))
     or local_start::time < coalesce(bk ->> 'startTime', '08:00')::time
     or local_end::time > coalesce(bk ->> 'endTime', '17:00')::time
     or local_end::date <> local_start::date then
    raise exception 'That time is outside booking hours.';
  end if;

  -- Still free?
  perform 1 from public.businesses where id = bid for update;
  cap := greatest(coalesce((bk ->> 'capacity')::int, 1), 1);
  select count(*) into clash from public.jobs j
   where j.business_id = bid and not j.deleted and coalesce(j.data ->> 'scheduledStart', '') <> ''
     and coalesce(j.data ->> 'status', '') <> 'cancelled'
     and (j.data ->> 'scheduledStart')::timestamptz < start_at + make_interval(mins => mins)
     and (j.data ->> 'scheduledStart')::timestamptz + make_interval(mins => greatest(coalesce((j.data ->> 'durationMins')::int, 60), 15)) > start_at;
  if clash >= cap then raise exception 'Sorry, that time was just taken – please pick another.'; end if;

  if biz_type = 'mobile' and addr = '' then raise exception 'Please enter the address where the car will be.'; end if;

  -- Customer: match by mobile, else add.
  select c.id into cust_id from public.customers c
   where c.business_id = bid and not c.deleted and public.au_mobile(c.data ->> 'phone') = v_phone
   order by c.server_ts desc limit 1;
  if cust_id is null then
    cust_id := gen_random_uuid()::text;
    insert into public.customers (business_id, id, data, updated_at) values (bid, cust_id, jsonb_build_object(
      'id', cust_id, 'name', name, 'phone', p ->> 'phone', 'email', email, 'address', addr,
      'notes', 'Booked online', 'createdAt', clock_timestamp()), now_ms);
  elsif email <> '' then
    update public.customers set data = data || jsonb_build_object('email', coalesce(nullif(data ->> 'email', ''), email)), updated_at = now_ms
     where business_id = bid and id = cust_id and coalesce(data ->> 'email', '') = '';
  end if;

  -- Vehicle: match by rego for this customer, else add (if they gave any car details).
  if rego <> '' then
    select v.id into veh_id from public.vehicles v
     where v.business_id = bid and not v.deleted and v.data ->> 'customerId' = cust_id and upper(replace(v.data ->> 'rego', ' ', '')) = rego limit 1;
  end if;
  if veh_id is null and (rego <> '' or coalesce(p ->> 'make', '') <> '' or coalesce(p ->> 'model', '') <> '') then
    veh_id := gen_random_uuid()::text;
    insert into public.vehicles (business_id, id, data, updated_at) values (bid, veh_id, jsonb_build_object(
      'id', veh_id, 'customerId', cust_id, 'rego', rego, 'make', left(coalesce(p ->> 'make', ''), 40), 'model', left(coalesce(p ->> 'model', ''), 40),
      'year', left(coalesce(p ->> 'year', ''), 4), 'vin', '', 'odometer', '', 'notes', ''), now_ms);
  end if;

  -- Price-list lines for the service.
  select coalesce(jsonb_agg(l || jsonb_build_object('id', gen_random_uuid()::text)), '[]'::jsonb) into lines
    from public.catalog c, jsonb_array_elements(c.data -> 'lines') l
   where c.business_id = bid and c.id = sv ->> 'catalogId' and not c.deleted;

  -- Next job number (same rules as allocate_job_number).
  select greatest(
    (select b.next_job_number from public.businesses b where b.id = bid),
    coalesce((select max((j.data ->> 'number')::int) from public.jobs j where j.business_id = bid), 0) + 1,
    coalesce((st ->> 'nextJobNumber')::int, 0)) into num;
  update public.businesses set next_job_number = num + 1 where id = bid;

  insert into public.jobs (business_id, id, data, updated_at) values (bid, job_id, jsonb_build_object(
    'id', job_id, 'number', num, 'customerId', cust_id, 'vehicleId', coalesce(veh_id, ''), 'status', 'scheduled',
    'title', sv ->> 'name', 'description', left(trim(coalesce(p ->> 'notes', '')), 1000),
    'siteAddress', case when biz_type = 'mobile' or (biz_type = 'both' and addr <> '') then addr else '' end,
    'location', case when biz_type = 'workshop' or (biz_type = 'both' and addr = '') then 'workshop' else 'onsite' end,
    'scheduledStart', to_char(start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"'), 'durationMins', mins,
    'odometer', '', 'lineItems', lines, 'workNotes', '', 'createdAt', clock_timestamp(), 'invoicedAt', '', 'paidAt', '',
    'bookedOnline', true), now_ms);

  insert into public.booking_attempts (business_id, phone) values (bid, v_phone);

  -- Tell the business.
  when_txt := to_char(local_start, 'FMDay FMDD Mon "at" FMHH12:MIam');
  perform public.push_to_business(bid, 'New online booking',
    name || ' booked ' || (sv ->> 'name') || ' – ' || when_txt, '/jobs/' || job_id, true);
  perform public.send_spannr_email(
    coalesce(nullif(trim(st ->> 'email'), ''), (select m.email from public.members m where m.business_id = bid and m.role = 'owner' limit 1)),
    'New online booking – ' || name || ', ' || when_txt,
    public.spannr_email_html('📅 New online booking',
      '<p><strong>' || public.html_escape(name) || '</strong> booked <strong>' || public.html_escape(sv ->> 'name') || '</strong> for <strong>' || when_txt || '</strong>.</p>'
      || '<p>' || public.html_escape(regexp_replace(v_phone, '^\+61', '0')) || coalesce(' · ' || nullif(public.html_escape(email), ''), '')
      || coalesce('<br>' || nullif(public.html_escape(trim(concat_ws(' ', rego, p ->> 'make', p ->> 'model'))), ''), '')
      || coalesce('<br>' || nullif(public.html_escape(addr), ''), '') || '</p>'
      || coalesce('<p><em>' || nullif(public.html_escape(p ->> 'notes'), '') || '</em></p>', '')
      || '<p style="margin:20px 0"><a href="https://app.spannr.au/jobs/' || job_id || '" style="display:inline-block;background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">Open the job</a></p>'),
    name || ' booked ' || (sv ->> 'name') || ' for ' || when_txt || '. Open: https://app.spannr.au/jobs/' || job_id);

  return jsonb_build_object('ok', true, 'when', when_txt, 'service', sv ->> 'name', 'number', num);
end $$;
grant execute on function public.public_create_booking(text, jsonb) to anon, authenticated;
