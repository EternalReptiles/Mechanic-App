-- Referrals: "give a month, get a month". A business shares spannr.au/?ref=CODE; the new business gets its first paid
-- month free, and when it starts paying the referrer earns a free month (taken off their next bill, or at checkout).

alter table public.businesses add column if not exists referral_code text unique;
alter table public.businesses add column if not exists referred_by uuid references public.businesses(id) on delete set null;
alter table public.businesses add column if not exists referral_discount_used boolean not null default false;
alter table public.businesses add column if not exists referral_rewarded_at timestamptz;
alter table public.businesses add column if not exists referral_credits int not null default 0;
alter table public.businesses add column if not exists referral_months_earned int not null default 0;

-- The business's code (made on first use): first letters of the name + 4 random characters, e.g. LNC-7Q2K.
create or replace function public.referral_code_for(bid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c text; base text; abc text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  select referral_code into c from public.businesses where id = bid;
  if c is not null then return c; end if;
  select coalesce(nullif(left(regexp_replace(upper(name), '[^A-Z]', '', 'g'), 4), ''), 'SPNR') into base from public.businesses where id = bid;
  loop
    c := base || '-';
    for i in 1..4 loop c := c || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    begin
      update public.businesses set referral_code = c where id = bid;
      return c;
    exception when unique_violation then -- try another
    end;
  end loop;
end $$;
revoke execute on function public.referral_code_for(uuid) from public, anon, authenticated;

-- Settings → Refer a mechanic.
create or replace function public.my_referrals(bid uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin(bid) then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'code', public.referral_code_for(bid),
    'signedUp', (select count(*) from public.businesses b where b.referred_by = bid),
    'paying', (select count(*) from public.businesses b where b.referred_by = bid and b.referral_rewarded_at is not null),
    'monthsEarned', (select referral_months_earned from public.businesses where id = bid),
    'credits', (select referral_credits from public.businesses where id = bid));
end $$;
grant execute on function public.my_referrals(uuid) to authenticated;

-- Who referred you (for the sign-up banner). Only the business name is shown.
create or replace function public.referral_name(p_code text) returns text
language sql stable security definer set search_path = '' as $$
  select name from public.businesses where referral_code = upper(trim(p_code)) and closed_at is null;
$$;
grant execute on function public.referral_name(text) to anon, authenticated;

-- A new business records who referred it (within its first week; never itself).
create or replace function public.claim_referral(bid uuid, p_code text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare ref uuid;
begin
  if not public.is_admin(bid) then return false; end if;
  select id into ref from public.businesses where referral_code = upper(trim(p_code)) and closed_at is null;
  if ref is null or ref = bid then return false; end if;
  update public.businesses set referred_by = ref
   where id = bid and referred_by is null and created_at > now() - interval '7 days';
  return found;
end $$;
grant execute on function public.claim_referral(uuid, text) to authenticated;

-- Called by the Stripe webhook when a business's subscription becomes active: rewards its referrer once.
-- Returns the referrer's id (or null when there's nothing to reward).
create or replace function public.referral_reward(p_bid uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ref uuid;
begin
  update public.businesses set referral_rewarded_at = now(), referral_discount_used = true
   where id = p_bid and referred_by is not null and referral_rewarded_at is null
   returning referred_by into ref;
  if ref is null then return null; end if;
  update public.businesses set referral_credits = referral_credits + 1, referral_months_earned = referral_months_earned + 1 where id = ref;
  return ref;
end $$;
revoke execute on function public.referral_reward(uuid) from public, anon, authenticated;
grant execute on function public.referral_reward(uuid) to service_role;
grant execute on function public.referral_code_for(uuid) to service_role;
