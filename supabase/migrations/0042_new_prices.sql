-- New plan allowances (Solo $49 / Pro $79 / Team $119 / Business $189): texts per month.
create or replace function public.plan_sms_allowance(p text) returns int language sql immutable as $$
  select case p when 'solo' then 50 when 'pro' then 150 when 'team' then 400 when 'business' then 800 when 'trial' then 50 else 0 end;
$$;
