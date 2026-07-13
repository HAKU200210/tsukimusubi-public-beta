-- 月結び Public Beta
-- Run in a NEW Supabase project. Do not run this in a private production project.

create extension if not exists pgcrypto;

create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  name_a text not null check (char_length(name_a) between 1 and 16),
  initial_a text not null check (char_length(initial_a) between 1 and 2),
  name_b text not null check (char_length(name_b) between 1 and 16),
  initial_b text not null check (char_length(initial_b) between 1 and 2),
  met_date date,
  dating_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.pair_access_codes (
  pair_id uuid not null references public.couples(id) on delete cascade,
  role text not null check (role in ('a','b')),
  code_hash text not null unique,
  updated_at timestamptz not null default now(),
  primary key (pair_id, role)
);

create table if not exists public.pair_members (
  pair_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('a','b')),
  display_name text not null check (char_length(display_name) between 1 and 16),
  avatar_initial text not null check (char_length(avatar_initial) between 1 and 2),
  joined_at timestamptz not null default now(),
  primary key (pair_id, user_id),
  unique (user_id)
);

create table if not exists public.monthly_reviews (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.couples(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  author_role text not null check (author_role in ('a','b')),
  author_user_id uuid not null references auth.users(id) on delete cascade,
  scores jsonb not null,
  grateful text not null check (char_length(grateful) between 1 and 500),
  happy text not null check (char_length(happy) between 1 and 500),
  difficult text not null check (char_length(difficult) between 1 and 500),
  hope text not null check (char_length(hope) between 1 and 500),
  self_change text not null check (char_length(self_change) between 1 and 500),
  renew text not null check (renew in ('yes','talk')),
  submitted_at timestamptz not null default now(),
  unique (pair_id, month, author_role)
);

create table if not exists public.album_photos (
  id uuid primary key,
  pair_id uuid not null references public.couples(id) on delete cascade,
  uploader_role text not null check (uploader_role in ('a','b')),
  uploader_user_id uuid not null references auth.users(id) on delete cascade,
  path text not null unique,
  name text not null,
  byte_size integer not null check (byte_size between 1 and 900000),
  created_at timestamptz not null default now()
);

create index if not exists monthly_reviews_pair_month_idx on public.monthly_reviews(pair_id, month);
create index if not exists album_photos_pair_created_idx on public.album_photos(pair_id, created_at desc);
create index if not exists pair_members_user_idx on public.pair_members(user_id);

create or replace function public.normalize_access_code(value text)
returns text language sql immutable strict
set search_path = public
as $$ select upper(regexp_replace(value, '[^A-Z0-9]', '', 'g')) $$;

create or replace function public.access_code_hash(value text)
returns text language sql immutable strict
set search_path = public, extensions
as $$ select encode(digest(public.normalize_access_code(value), 'sha256'), 'hex') $$;

create or replace function public.my_pair_id()
returns uuid language sql stable security definer
set search_path = public
as $$ select pair_id from public.pair_members where user_id = auth.uid() limit 1 $$;

create or replace function public.my_pair_role()
returns text language sql stable security definer
set search_path = public
as $$ select role from public.pair_members where user_id = auth.uid() limit 1 $$;

create or replace function public.both_reviews_submitted(p_pair_id uuid, p_month date)
returns boolean language sql stable security definer
set search_path = public
as $$
  select count(distinct author_role) = 2
  from public.monthly_reviews
  where pair_id = p_pair_id and month = p_month
$$;

alter table public.couples enable row level security;
alter table public.pair_access_codes enable row level security;
alter table public.pair_members enable row level security;
alter table public.monthly_reviews enable row level security;
alter table public.album_photos enable row level security;

drop policy if exists "members read their pair" on public.couples;
create policy "members read their pair" on public.couples for select to authenticated
using (id = public.my_pair_id());

drop policy if exists "members read pair members" on public.pair_members;
create policy "members read pair members" on public.pair_members for select to authenticated
using (pair_id = public.my_pair_id());

drop policy if exists "sealed monthly reviews" on public.monthly_reviews;
create policy "sealed monthly reviews" on public.monthly_reviews for select to authenticated
using (
  pair_id = public.my_pair_id()
  and (author_role = public.my_pair_role() or public.both_reviews_submitted(pair_id, month))
);

drop policy if exists "members read album metadata" on public.album_photos;
create policy "members read album metadata" on public.album_photos for select to authenticated
using (pair_id = public.my_pair_id());

drop policy if exists "members delete album metadata" on public.album_photos;
create policy "members delete album metadata" on public.album_photos for delete to authenticated
using (pair_id = public.my_pair_id());

create or replace function public.get_pair_context()
returns jsonb language plpgsql stable security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_member public.pair_members;
  v_pair public.couples;
  v_members jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_member from public.pair_members where user_id = v_user limit 1;
  if v_member.user_id is null then return null; end if;
  select * into v_pair from public.couples where id = v_member.pair_id;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.role, m.joined_at), '[]'::jsonb)
    into v_members from public.pair_members m where m.pair_id = v_member.pair_id;
  return jsonb_build_object('pair', to_jsonb(v_pair), 'membership', to_jsonb(v_member), 'members', v_members, 'role', v_member.role);
end;
$$;

create or replace function public.create_pair(
  p_name_a text, p_initial_a text, p_name_b text, p_initial_b text,
  p_met_date date, p_dating_date date, p_code_a text, p_code_b text
)
returns uuid language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pair uuid;
  v_code_a text := public.normalize_access_code(p_code_a);
  v_code_b text := public.normalize_access_code(p_code_b);
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from public.pair_members where user_id = v_user) then raise exception 'This device is already paired'; end if;
  if char_length(trim(p_name_a)) not between 1 and 16 or char_length(trim(p_name_b)) not between 1 and 16 then raise exception 'Invalid display name'; end if;
  if char_length(trim(p_initial_a)) not between 1 and 2 or char_length(trim(p_initial_b)) not between 1 and 2 then raise exception 'Invalid avatar initial'; end if;
  if char_length(v_code_a) < 16 or char_length(v_code_b) < 16 or v_code_a = v_code_b then raise exception 'Invalid access codes'; end if;

  insert into public.couples(name_a, initial_a, name_b, initial_b, met_date, dating_date)
  values(trim(p_name_a), trim(p_initial_a), trim(p_name_b), trim(p_initial_b), p_met_date, p_dating_date)
  returning id into v_pair;

  insert into public.pair_access_codes(pair_id, role, code_hash) values
    (v_pair, 'a', public.access_code_hash(v_code_a)),
    (v_pair, 'b', public.access_code_hash(v_code_b));
  insert into public.pair_members(pair_id, user_id, role, display_name, avatar_initial)
  values(v_pair, v_user, 'a', trim(p_name_a), trim(p_initial_a));
  return v_pair;
end;
$$;

create or replace function public.join_pair(p_code text)
returns uuid language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pair uuid;
  v_role text;
  v_pair_row public.couples;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if exists(select 1 from public.pair_members where user_id = v_user) then raise exception 'This device is already paired'; end if;
  select pair_id, role into v_pair, v_role
    from public.pair_access_codes where code_hash = public.access_code_hash(p_code) limit 1;
  if v_pair is null then raise exception 'Invalid invitation code'; end if;
  select * into v_pair_row from public.couples where id = v_pair;
  insert into public.pair_members(pair_id, user_id, role, display_name, avatar_initial)
  values(
    v_pair, v_user, v_role,
    case when v_role = 'a' then v_pair_row.name_a else v_pair_row.name_b end,
    case when v_role = 'a' then v_pair_row.initial_a else v_pair_row.initial_b end
  );
  return v_pair;
end;
$$;

create or replace function public.monthly_submission_status(p_month date)
returns jsonb language plpgsql stable security definer
set search_path = public
as $$
declare v_pair uuid := public.my_pair_id();
begin
  if v_pair is null then raise exception 'Pairing required'; end if;
  return jsonb_build_object(
    'a', exists(select 1 from public.monthly_reviews where pair_id=v_pair and month=p_month and author_role='a'),
    'b', exists(select 1 from public.monthly_reviews where pair_id=v_pair and month=p_month and author_role='b')
  );
end;
$$;

create or replace function public.submit_monthly_review(
  p_month date, p_scores jsonb, p_grateful text, p_happy text,
  p_difficult text, p_hope text, p_self_change text, p_renew text
)
returns uuid language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pair uuid := public.my_pair_id();
  v_role text := public.my_pair_role();
  v_key text;
  v_id uuid;
begin
  if v_user is null or v_pair is null or v_role is null then raise exception 'Pairing required'; end if;
  if p_month <> date_trunc('month', p_month)::date then raise exception 'Invalid month'; end if;
  foreach v_key in array array['communication','trust','care','time','support','affection'] loop
    if not (p_scores ? v_key) or (p_scores->>v_key)::int not between 1 and 10 then raise exception 'Invalid score'; end if;
  end loop;
  if p_renew not in ('yes','talk') then raise exception 'Invalid renewal choice'; end if;
  insert into public.monthly_reviews(pair_id,month,author_role,author_user_id,scores,grateful,happy,difficult,hope,self_change,renew)
  values(v_pair,p_month,v_role,v_user,p_scores,trim(p_grateful),trim(p_happy),trim(p_difficult),trim(p_hope),trim(p_self_change),p_renew)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_my_profile(p_display_name text, p_initial text)
returns void language plpgsql security definer
set search_path = public
as $$
declare v_pair uuid := public.my_pair_id(); v_role text := public.my_pair_role();
begin
  if v_pair is null then raise exception 'Pairing required'; end if;
  if char_length(trim(p_display_name)) not between 1 and 16 or char_length(trim(p_initial)) not between 1 and 2 then raise exception 'Invalid profile'; end if;
  update public.pair_members set display_name=trim(p_display_name), avatar_initial=trim(p_initial) where pair_id=v_pair and role=v_role;
  if v_role='a' then update public.couples set name_a=trim(p_display_name), initial_a=trim(p_initial) where id=v_pair;
  else update public.couples set name_b=trim(p_display_name), initial_b=trim(p_initial) where id=v_pair; end if;
end;
$$;

create or replace function public.rotate_partner_code(p_code text)
returns void language plpgsql security definer
set search_path = public
as $$
declare v_pair uuid := public.my_pair_id();
begin
  if v_pair is null or public.my_pair_role() <> 'a' then raise exception 'Only the creator can renew the invitation code'; end if;
  if char_length(public.normalize_access_code(p_code)) < 16 then raise exception 'Invalid access code'; end if;
  update public.pair_access_codes set code_hash=public.access_code_hash(p_code), updated_at=now() where pair_id=v_pair and role='b';
end;
$$;

create or replace function public.rotate_my_recovery_code(p_code text)
returns void language plpgsql security definer
set search_path = public
as $$
declare v_pair uuid := public.my_pair_id(); v_role text := public.my_pair_role();
begin
  if v_pair is null or v_role is null then raise exception 'Pairing required'; end if;
  if char_length(public.normalize_access_code(p_code)) < 16 then raise exception 'Invalid access code'; end if;
  update public.pair_access_codes set code_hash=public.access_code_hash(p_code), updated_at=now() where pair_id=v_pair and role=v_role;
end;
$$;

create or replace function public.reserve_album_photo(p_id uuid, p_path text, p_name text, p_size integer)
returns uuid language plpgsql security definer
set search_path = public
as $$
declare v_user uuid := auth.uid(); v_pair uuid := public.my_pair_id(); v_role text := public.my_pair_role();
begin
  if v_pair is null then raise exception 'Pairing required'; end if;
  if p_size not between 1 and 900000 then raise exception 'Photo must be 900 KB or smaller'; end if;
  if (select count(*) from public.album_photos where pair_id=v_pair) >= 24 then raise exception 'Album quota reached'; end if;
  if p_path <> (v_pair::text || '/' || p_id::text || '.jpg') then raise exception 'Invalid storage path'; end if;
  insert into public.album_photos(id,pair_id,uploader_role,uploader_user_id,path,name,byte_size)
  values(p_id,v_pair,v_role,v_user,p_path,left(coalesce(p_name,'photo.jpg'),120),p_size);
  return p_id;
end;
$$;

create or replace function public.delete_my_account()
returns void language plpgsql security definer
set search_path = public, auth
as $$
declare v_user uuid := auth.uid(); v_pair uuid := public.my_pair_id();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  delete from public.pair_members where user_id=v_user;
  if v_pair is not null and not exists(select 1 from public.pair_members where pair_id=v_pair) then delete from public.couples where id=v_pair; end if;
  delete from auth.users where id=v_user;
end;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('couple-album','couple-album',false,900000,array['image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=900000,allowed_mime_types=array['image/jpeg'];

drop policy if exists "pair members read album files" on storage.objects;
create policy "pair members read album files" on storage.objects for select to authenticated
using (bucket_id='couple-album' and (storage.foldername(name))[1] = public.my_pair_id()::text);

drop policy if exists "reserved album uploads only" on storage.objects;
create policy "reserved album uploads only" on storage.objects for insert to authenticated
with check (
  bucket_id='couple-album'
  and exists(select 1 from public.album_photos p where p.path=name and p.pair_id=public.my_pair_id() and p.uploader_user_id=auth.uid())
);

drop policy if exists "pair members delete album files" on storage.objects;
create policy "pair members delete album files" on storage.objects for delete to authenticated
using (bucket_id='couple-album' and (storage.foldername(name))[1] = public.my_pair_id()::text);

revoke all on public.couples, public.pair_access_codes, public.pair_members, public.monthly_reviews, public.album_photos from anon;
grant select on public.couples, public.pair_members, public.monthly_reviews, public.album_photos to authenticated;
grant delete on public.album_photos to authenticated;

revoke all on function public.get_pair_context() from public, anon;
revoke all on function public.create_pair(text,text,text,text,date,date,text,text) from public, anon;
revoke all on function public.join_pair(text) from public, anon;
revoke all on function public.monthly_submission_status(date) from public, anon;
revoke all on function public.submit_monthly_review(date,jsonb,text,text,text,text,text,text) from public, anon;
revoke all on function public.update_my_profile(text,text) from public, anon;
revoke all on function public.rotate_partner_code(text) from public, anon;
revoke all on function public.rotate_my_recovery_code(text) from public, anon;
revoke all on function public.reserve_album_photo(uuid,text,text,integer) from public, anon;
revoke all on function public.delete_my_account() from public, anon;

grant execute on function public.get_pair_context() to authenticated;
grant execute on function public.create_pair(text,text,text,text,date,date,text,text) to authenticated;
grant execute on function public.join_pair(text) to authenticated;
grant execute on function public.monthly_submission_status(date) to authenticated;
grant execute on function public.submit_monthly_review(date,jsonb,text,text,text,text,text,text) to authenticated;
grant execute on function public.update_my_profile(text,text) to authenticated;
grant execute on function public.rotate_partner_code(text) to authenticated;
grant execute on function public.rotate_my_recovery_code(text) to authenticated;
grant execute on function public.reserve_album_photo(uuid,text,text,integer) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

revoke all on function public.my_pair_id(), public.my_pair_role(), public.both_reviews_submitted(uuid,date), public.normalize_access_code(text), public.access_code_hash(text) from public, anon;
grant execute on function public.my_pair_id(), public.my_pair_role(), public.both_reviews_submitted(uuid,date) to authenticated;
