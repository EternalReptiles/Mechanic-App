-- Remote sign-offs: besides video walk-arounds, the same signed-link flow now covers
-- quote approval (before work) and job completion sign-off (after work), and every kind
-- can carry the business's terms & conditions, which the customer must agree to.

alter table public.walkarounds add column if not exists kind text not null default 'walkaround';
alter table public.walkarounds drop constraint if exists walkarounds_kind_check;
alter table public.walkarounds add constraint walkarounds_kind_check check (kind in ('walkaround', 'quote', 'completion'));
alter table public.walkarounds add column if not exists terms_agreed boolean;

create or replace function public.walkaround_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.content_hash := encode(extensions.digest(new.kind || new.content::text || coalesce(new.video_path, ''), 'sha256'), 'hex');
    new.viewed_at := null; new.responded_at := null; new.decisions := null; new.signature := null; new.terms_agreed := null;
    return new;
  end if;
  if new.content is distinct from old.content or new.video_path is distinct from old.video_path
     or new.content_hash is distinct from old.content_hash or new.token is distinct from old.token
     or new.business_id is distinct from old.business_id or new.job_id is distinct from old.job_id
     or new.kind is distinct from old.kind then
    raise exception 'A sent request cannot be changed';
  end if;
  if old.responded_at is not null and (
       new.responded_at is distinct from old.responded_at or new.decisions is distinct from old.decisions
       or new.signature is distinct from old.signature or new.signed_name is distinct from old.signed_name
       or new.approved_total is distinct from old.approved_total or new.signer_ip is distinct from old.signer_ip
       or new.signer_user_agent is distinct from old.signer_user_agent or new.terms_agreed is distinct from old.terms_agreed) then
    raise exception 'A signed response cannot be changed';
  end if;
  return new;
end $$;

create or replace function public.get_walkaround(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w public.walkarounds;
begin
  select * into w from public.walkarounds where token = p_token;
  if not found then return null; end if;
  if w.viewed_at is null and w.responded_at is null then
    update public.walkarounds set viewed_at = now() where id = w.id;
  end if;
  return jsonb_build_object(
    'kind', w.kind,
    'content', w.content,
    'video_path', w.video_path,
    'created_at', w.created_at,
    'expired', w.responded_at is null and w.expires_at < now(),
    'responded_at', w.responded_at,
    'decisions', w.decisions,
    'approved_total', w.approved_total,
    'signed_name', w.signed_name,
    'signature', w.signature,
    'terms_agreed', w.terms_agreed
  );
end $$;

drop function if exists public.respond_walkaround(text, jsonb, text, text);
create or replace function public.respond_walkaround(
  p_token text, p_decisions jsonb, p_name text, p_signature text, p_agree_terms boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  w public.walkarounds;
  item jsonb;
  d text;
  total numeric := 0;
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
  if coalesce(trim(w.content ->> 'terms'), '') <> '' and not coalesce(p_agree_terms, false) then
    raise exception 'Please tick the box to agree to the terms and conditions';
  end if;
  if w.kind = 'walkaround' then
    for item in select * from jsonb_array_elements(w.content -> 'items') loop
      d := p_decisions ->> (item ->> 'id');
      if d is null or d not in ('approved', 'declined') then
        raise exception 'Please choose Yes or No for every item';
      end if;
      if d = 'approved' then total := total + coalesce((item ->> 'total')::numeric, 0); end if;
    end loop;
  else
    -- Quote approval / job sign-off: the customer agrees to the whole amount shown.
    total := coalesce((w.content ->> 'total')::numeric, 0);
    p_decisions := null;
  end if;
  update public.walkarounds set
    responded_at = now(),
    decisions = p_decisions,
    approved_total = total,
    signed_name = left(trim(p_name), 200),
    signature = p_signature,
    terms_agreed = coalesce(trim(w.content ->> 'terms'), '') <> '' and coalesce(p_agree_terms, false),
    signer_ip = left(split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1), 100),
    signer_user_agent = left(coalesce(headers ->> 'user-agent', ''), 500)
  where id = w.id;
  return jsonb_build_object('approved_total', total, 'responded_at', now());
end $$;

grant execute on function public.respond_walkaround(text, jsonb, text, text, boolean) to anon, authenticated;
