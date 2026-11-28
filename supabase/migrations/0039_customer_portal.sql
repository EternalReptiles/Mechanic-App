-- Customer portal: app.spannr.au/my/<token> – a customer's own page (in the business's branding) with their cars,
-- next service due, service history, invoices (with "Pay now" for open card invoices) and a "Book again" button.
-- The token lives on the customer record (data.portalToken); only someone with the link can see the page.

create index if not exists customers_portal_token_idx on public.customers ((data ->> 'portalToken')) where data ? 'portalToken';

create or replace function public.public_customer_portal(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c record;
  st jsonb;
  gst boolean;
  slug text;
  vehicles jsonb;
  jobs jsonb;
begin
  if coalesce(length(p_token), 0) < 16 then return null; end if;
  select cu.business_id, cu.id, cu.data into c from public.customers cu
   where cu.data ->> 'portalToken' = p_token and not cu.deleted limit 1;
  if c.id is null then return null; end if;
  if exists (select 1 from public.businesses b where b.id = c.business_id and b.closed_at is not null) then return null; end if;
  select data into st from public.settings where business_id = c.business_id and id = 'settings';
  gst := coalesce((st ->> 'gstRegistered')::boolean, true);
  select case when coalesce((st -> 'booking' ->> 'enabled')::boolean, false) then b.booking_slug end into slug
    from public.businesses b where b.id = c.business_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'rego', v.data ->> 'rego', 'make', v.data ->> 'make', 'model', v.data ->> 'model', 'year', v.data ->> 'year',
      'odometer', v.data ->> 'odometer', 'nextServiceDate', v.data ->> 'nextServiceDate', 'nextServiceKm', v.data ->> 'nextServiceKm',
      'regoExpiry', v.data ->> 'regoExpiry') order by v.data ->> 'rego'), '[]'::jsonb)
    into vehicles from public.vehicles v
   where v.business_id = c.business_id and not v.deleted and v.data ->> 'customerId' = c.id;

  select coalesce(jsonb_agg(x order by x ->> 'date' desc), '[]'::jsonb) into jobs from (
    select jsonb_build_object(
      'number', (j.data ->> 'number')::int,
      'date', coalesce(nullif(j.data ->> 'paidAt', ''), nullif(j.data ->> 'invoicedAt', ''), nullif(j.data ->> 'finishedAt', ''), j.data ->> 'createdAt'),
      'title', j.data ->> 'title',
      'status', j.data ->> 'status',
      'vehicleId', j.data ->> 'vehicleId',
      'odometer', j.data ->> 'odometer',
      'notes', left(j.data ->> 'workNotes', 600),
      'total', round((select coalesce(sum((l ->> 'qty')::numeric * (l ->> 'unitPrice')::numeric), 0)
                      from jsonb_array_elements(coalesce(j.data -> 'lineItems', '[]'::jsonb)) l) * case when gst then 1.1 else 1 end, 2),
      'payUrl', (select si.hosted_invoice_url from public.stripe_invoices si
                  where si.business_id = j.business_id and si.job_id = j.id and si.status = 'open'
                  order by si.created_at desc limit 1)
    ) as x
    from public.jobs j
    where j.business_id = c.business_id and not j.deleted and j.data ->> 'customerId' = c.id
      and j.data ->> 'status' in ('scheduled', 'in_progress', 'waiting', 'completed', 'invoiced', 'paid')
    order by coalesce(nullif(j.data ->> 'paidAt', ''), j.data ->> 'createdAt') desc
    limit 40) q;

  return jsonb_build_object(
    'business', jsonb_build_object(
      'name', st ->> 'businessName', 'phone', st ->> 'phone', 'email', st ->> 'email', 'logo', nullif(st ->> 'logo', ''),
      'brandColor', st ->> 'brandColor', 'address', st ->> 'address', 'abn', st ->> 'abn', 'website', st ->> 'website',
      'bookingUrl', case when slug is not null then 'https://app.spannr.au/book/' || slug end),
    'customer', jsonb_build_object('firstName', split_part(trim(c.data ->> 'name'), ' ', 1)),
    'vehicles', vehicles,
    'jobs', jobs);
end $$;
grant execute on function public.public_customer_portal(text) to anon, authenticated;
