-- When the link was actually sent to the customer (text, email, own phone or copied) –
-- creating the link isn't the same as sending it.
alter table public.walkarounds add column if not exists delivered_at timestamptz;
update public.walkarounds set delivered_at = created_at where delivered_at is null;
grant update (seen_by_business_at, delivered_at) on public.walkarounds to authenticated;
