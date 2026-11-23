-- Video walk-around: a video + recommended work sent to the customer, who approves or
-- declines each item and signs. Customers use a secret link (no login), so all of their
-- access goes through the two functions below. A response is locked once signed.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.walkarounds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  job_id text not null,
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  video_path text,
  -- Snapshot of exactly what the customer is shown (business, vehicle, items, prices).
  content jsonb not null,
  -- SHA-256 of content + video path at the moment it was sent.
  content_hash text,
  viewed_at timestamptz,
  responded_at timestamptz,
  decisions jsonb,
  approved_total numeric(12, 2),
  signed_name text,
  signature text,
  signer_ip text,
  signer_user_agent text,
  seen_by_business_at timestamptz
);
create index if not exists walkarounds_job_idx on public.walkarounds (business_id, job_id);

create or replace function public.walkaround_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.content_hash := encode(extensions.digest(new.content::text || coalesce(new.video_path, ''), 'sha256'), 'hex');
    new.viewed_at := null; new.responded_at := null; new.decisions := null; new.signature := null;
    return new;
  end if;
  if new.content is distinct from old.content or new.video_path is distinct from old.video_path
     or new.content_hash is distinct from old.content_hash or new.token is distinct from old.token
     or new.business_id is distinct from old.business_id or new.job_id is distinct from old.job_id then
    raise exception 'A sent walk-around cannot be changed';
  end if;
  if old.responded_at is not null and (
       new.responded_at is distinct from old.responded_at or new.decisions is distinct from old.decisions
       or new.signature is distinct from old.signature or new.signed_name is distinct from old.signed_name
       or new.approved_total is distinct from old.approved_total or new.signer_ip is distinct from old.signer_ip
       or new.signer_user_agent is distinct from old.signer_user_agent) then
    raise exception 'A signed response cannot be changed';
  end if;
  return new;
end $$;

drop trigger if exists walkarounds_guard on public.walkarounds;
create trigger walkarounds_guard before insert or update on public.walkarounds
  for each row execute function public.walkaround_guard();

alter table public.walkarounds enable row level security;
drop policy if exists "members read walkarounds" on public.walkarounds;
create policy "members read walkarounds" on public.walkarounds for select to authenticated using (public.is_member(business_id));
drop policy if exists "members send walkarounds" on public.walkarounds;
create policy "members send walkarounds" on public.walkarounds for insert to authenticated with check (public.is_member(business_id));
drop policy if exists "members mark seen" on public.walkarounds;
create policy "members mark seen" on public.walkarounds for update to authenticated
  using (public.is_member(business_id)) with check (public.is_member(business_id));

revoke all on public.walkarounds from anon, authenticated;
grant select, insert on public.walkarounds to authenticated;
grant update (seen_by_business_at) on public.walkarounds to authenticated;

-- Customer opens the link.
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
    'content', w.content,
    'video_path', w.video_path,
    'created_at', w.created_at,
    'expired', w.responded_at is null and w.expires_at < now(),
    'responded_at', w.responded_at,
    'decisions', w.decisions,
    'approved_total', w.approved_total,
    'signed_name', w.signed_name,
    'signature', w.signature
  );
end $$;

-- Customer approves/declines each item and signs. Can only happen once.
create or replace function public.respond_walkaround(p_token text, p_decisions jsonb, p_name text, p_signature text) returns jsonb
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
  if w.responded_at is not null then raise exception 'You have already responded to this quote'; end if;
  if w.expires_at < now() then raise exception 'This link has expired – please contact the business'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Please type your name'; end if;
  if coalesce(p_signature, '') not like 'data:image/png;base64,%' or length(p_signature) > 400000 then
    raise exception 'Please sign in the box';
  end if;
  for item in select * from jsonb_array_elements(w.content -> 'items') loop
    d := p_decisions ->> (item ->> 'id');
    if d is null or d not in ('approved', 'declined') then
      raise exception 'Please choose Yes or No for every item';
    end if;
    if d = 'approved' then total := total + coalesce((item ->> 'total')::numeric, 0); end if;
  end loop;
  update public.walkarounds set
    responded_at = now(),
    decisions = p_decisions,
    approved_total = total,
    signed_name = left(trim(p_name), 200),
    signature = p_signature,
    signer_ip = left(split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1), 100),
    signer_user_agent = left(coalesce(headers ->> 'user-agent', ''), 500)
  where id = w.id;
  return jsonb_build_object('approved_total', total, 'responded_at', now());
end $$;

grant execute on function public.get_walkaround(text) to anon, authenticated;
grant execute on function public.respond_walkaround(text, jsonb, text, text) to anon, authenticated;

-- Videos: public bucket with unguessable paths (like an unlisted video). Nobody can list it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('walkaround-videos', 'walkaround-videos', true, 52428800, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "members upload videos" on storage.objects;
create policy "members upload videos" on storage.objects for insert to authenticated
  with check (bucket_id = 'walkaround-videos' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "members delete videos" on storage.objects;
create policy "members delete videos" on storage.objects for delete to authenticated
  using (bucket_id = 'walkaround-videos' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "members read own videos" on storage.objects;
create policy "members read own videos" on storage.objects for select to authenticated
  using (bucket_id = 'walkaround-videos' and public.is_member(((storage.foldername(name))[1])::uuid));
