-- Quotes can now be declined (with an optional reason) as well as approved.
-- The decline is signed and locked exactly like an approval.
-- For quotes, decisions = {"outcome": "approved"} or {"outcome": "declined", "reason": "..."}.

create or replace function public.respond_walkaround(
  p_token text, p_decisions jsonb, p_name text, p_signature text, p_agree_terms boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  w public.walkarounds;
  item jsonb;
  d text;
  total numeric := 0;
  agreeing boolean := true; -- false when the customer declines the whole quote
  has_terms boolean;
  headers json := nullif(current_setting('request.headers', true), '')::json;
begin
  select * into w from public.walkarounds where token = p_token for update;
  if not found then raise exception 'This link is not valid'; end if;
  if w.responded_at is not null then raise exception 'You have already responded to this request'; end if;
  if w.expires_at < now() then raise exception 'This link has expired – please contact the business'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Please type your name'; end if;
  if coalesce(p_signature, '') not like 'data:image/png;base64,%' or length(p_signature) > 400000 then
    raise exception 'Please sign in the box';
  end if;

  if w.kind = 'walkaround' then
    for item in select * from jsonb_array_elements(w.content -> 'items') loop
      d := p_decisions ->> (item ->> 'id');
      if d is null or d not in ('approved', 'declined') then
        raise exception 'Please choose Yes or No for every item';
      end if;
      if d = 'approved' then total := total + coalesce((item ->> 'total')::numeric, 0); end if;
    end loop;
  elsif w.kind = 'quote' then
    d := coalesce(p_decisions ->> 'outcome', '');
    if d not in ('approved', 'declined') then raise exception 'Please choose Approve or Decline'; end if;
    if d = 'declined' then
      agreeing := false;
      total := 0;
      p_decisions := jsonb_build_object('outcome', 'declined', 'reason', left(trim(coalesce(p_decisions ->> 'reason', '')), 500));
    else
      total := coalesce((w.content ->> 'total')::numeric, 0);
      p_decisions := jsonb_build_object('outcome', 'approved');
    end if;
  else
    total := coalesce((w.content ->> 'total')::numeric, 0);
    p_decisions := null;
  end if;

  has_terms := coalesce(trim(w.content ->> 'terms'), '') <> '';
  if agreeing and has_terms and not coalesce(p_agree_terms, false) then
    raise exception 'Please tick the box to agree to the terms and conditions';
  end if;

  update public.walkarounds set
    responded_at = now(),
    decisions = p_decisions,
    approved_total = total,
    signed_name = left(trim(p_name), 200),
    signature = p_signature,
    terms_agreed = agreeing and has_terms and coalesce(p_agree_terms, false),
    signer_ip = left(split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1), 100),
    signer_user_agent = left(coalesce(headers ->> 'user-agent', ''), 500)
  where id = w.id;
  return jsonb_build_object('approved_total', total, 'responded_at', now());
end $$;

grant execute on function public.respond_walkaround(text, jsonb, text, text, boolean) to anon, authenticated;
