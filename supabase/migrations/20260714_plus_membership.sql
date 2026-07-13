-- 月結び Plus / 2026-07-14
-- Run once in the public Supabase project's SQL Editor.

create table if not exists public.pair_entitlements (
  pair_id uuid primary key references public.couples(id) on delete cascade,
  plus_expires_at timestamptz,
  source text not null default 'manual_beta' check (source in ('manual_beta','line_iap','support')),
  last_order_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.iap_orders (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.couples(id) on delete cascade,
  buyer_user_id uuid references auth.users(id) on delete set null,
  line_order_id text not null unique,
  product_id text not null check (product_id in ('iap_ln_036','iap_ln_091')),
  plan_months integer not null check (plan_months in (1,3)),
  amount_jpy integer not null check (amount_jpy in (290,790)),
  status text not null check (status in ('pending','paid','cancelled','refunded')),
  purchased_at timestamptz,
  expires_at timestamptz,
  raw_receipt jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pair_anniversaries (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.couples(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 50),
  event_date date not null,
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.pair_date_records (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.couples(id) on delete cascade,
  date_on date not null,
  title text not null check (char_length(trim(title)) between 1 and 60),
  place text not null default '' check (char_length(place) <= 80),
  memory text not null default '' check (char_length(memory) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.pair_date_wishes (
  id uuid primary key default gen_random_uuid(),
  pair_id uuid not null references public.couples(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 60),
  place text not null default '' check (char_length(place) <= 80),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'planned' check (status in ('planned','done')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists pair_anniversaries_pair_date_idx on public.pair_anniversaries(pair_id,event_date);
create index if not exists pair_date_records_pair_date_idx on public.pair_date_records(pair_id,date_on desc);
create index if not exists pair_date_wishes_pair_status_idx on public.pair_date_wishes(pair_id,status,created_at desc);
create index if not exists iap_orders_pair_idx on public.iap_orders(pair_id,created_at desc);

alter table public.monthly_reviews add column if not exists question_pack text not null default 'standard';
alter table public.monthly_reviews add column if not exists extra_answers jsonb not null default '{}'::jsonb;
alter table public.monthly_reviews drop constraint if exists monthly_reviews_renew_check;
alter table public.monthly_reviews add constraint monthly_reviews_renew_check
  check (renew in ('yes','continue','improve','talk','end'));
alter table public.monthly_reviews drop constraint if exists monthly_reviews_question_pack_check;
alter table public.monthly_reviews add constraint monthly_reviews_question_pack_check
  check (question_pack in ('standard','future','closeness','repair'));
alter table public.monthly_reviews drop constraint if exists monthly_reviews_extra_answers_check;
alter table public.monthly_reviews add constraint monthly_reviews_extra_answers_check
  check (jsonb_typeof(extra_answers) = 'object' and char_length(extra_answers::text) <= 4000);

alter table public.pair_entitlements enable row level security;
alter table public.iap_orders enable row level security;
alter table public.pair_anniversaries enable row level security;
alter table public.pair_date_records enable row level security;
alter table public.pair_date_wishes enable row level security;

drop policy if exists "members read their entitlement" on public.pair_entitlements;
create policy "members read their entitlement" on public.pair_entitlements for select to authenticated
using (pair_id = public.my_pair_id());

drop policy if exists "members read anniversaries" on public.pair_anniversaries;
create policy "members read anniversaries" on public.pair_anniversaries for select to authenticated
using (pair_id = public.my_pair_id());
drop policy if exists "members delete anniversaries" on public.pair_anniversaries;
create policy "members delete anniversaries" on public.pair_anniversaries for delete to authenticated
using (pair_id = public.my_pair_id());

drop policy if exists "members read date records" on public.pair_date_records;
create policy "members read date records" on public.pair_date_records for select to authenticated
using (pair_id = public.my_pair_id());
drop policy if exists "members delete date records" on public.pair_date_records;
create policy "members delete date records" on public.pair_date_records for delete to authenticated
using (pair_id = public.my_pair_id());

drop policy if exists "members read date wishes" on public.pair_date_wishes;
create policy "members read date wishes" on public.pair_date_wishes for select to authenticated
using (pair_id = public.my_pair_id());
drop policy if exists "members delete date wishes" on public.pair_date_wishes;
create policy "members delete date wishes" on public.pair_date_wishes for delete to authenticated
using (pair_id = public.my_pair_id());

create or replace function public.my_pair_is_plus()
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists(
    select 1 from public.pair_entitlements e
    where e.pair_id = public.my_pair_id() and e.plus_expires_at > now()
  )
$$;

create or replace function public.get_pair_context()
returns jsonb language plpgsql stable security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_member public.pair_members;
  v_pair public.couples;
  v_members jsonb;
  v_expires timestamptz;
  v_plus boolean := false;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_member from public.pair_members where user_id = v_user limit 1;
  if v_member.user_id is null then return null; end if;
  select * into v_pair from public.couples where id = v_member.pair_id;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.role,m.joined_at),'[]'::jsonb)
    into v_members from public.pair_members m where m.pair_id = v_member.pair_id;
  select plus_expires_at into v_expires from public.pair_entitlements where pair_id = v_member.pair_id;
  v_plus := coalesce(v_expires > now(),false);
  return jsonb_build_object(
    'pair',to_jsonb(v_pair),'membership',to_jsonb(v_member),'members',v_members,'role',v_member.role,
    'entitlement',jsonb_build_object('tier',case when v_plus then 'plus' else 'free' end,'is_plus',v_plus,'expires_at',v_expires),
    'limits',jsonb_build_object(
      'photos',case when v_plus then 300 else 24 end,
      'anniversaries',case when v_plus then 100 else 3 end,
      'date_records',case when v_plus then 500 else 10 end,
      'date_wishes',case when v_plus then 200 else 10 end
    )
  );
end;
$$;

create or replace function public.submit_monthly_review_v2(
  p_month date,p_scores jsonb,p_grateful text,p_happy text,
  p_difficult text,p_hope text,p_self_change text,p_renew text,
  p_question_pack text default 'standard',p_extra_answers jsonb default '{}'::jsonb
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
  if p_month <> date_trunc('month',p_month)::date then raise exception 'Invalid month'; end if;
  foreach v_key in array array['communication','trust','care','time','support','affection'] loop
    if not (p_scores ? v_key) or (p_scores->>v_key)::int not between 1 and 10 then raise exception 'Invalid score'; end if;
  end loop;
  if p_renew not in ('continue','improve','talk','end') then raise exception 'Invalid renewal choice'; end if;
  if p_question_pack not in ('standard','future','closeness','repair') then raise exception 'Invalid question pack'; end if;
  if jsonb_typeof(coalesce(p_extra_answers,'{}'::jsonb)) <> 'object' or char_length(coalesce(p_extra_answers,'{}'::jsonb)::text) > 4000 then raise exception 'Invalid extra answers'; end if;
  if p_question_pack <> 'standard' and not public.my_pair_is_plus() then raise exception 'Plus membership required'; end if;
  insert into public.monthly_reviews(
    pair_id,month,author_role,author_user_id,scores,grateful,happy,difficult,hope,self_change,renew,question_pack,extra_answers
  ) values(
    v_pair,p_month,v_role,v_user,p_scores,trim(p_grateful),trim(p_happy),trim(p_difficult),trim(p_hope),trim(p_self_change),p_renew,p_question_pack,coalesce(p_extra_answers,'{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_anniversary(p_event_date date,p_title text,p_note text default '')
returns uuid language plpgsql security definer
set search_path = public
as $$
declare v_pair uuid := public.my_pair_id(); v_limit integer; v_id uuid;
begin
  if v_pair is null then raise exception 'Pairing required'; end if;
  v_limit := case when public.my_pair_is_plus() then 100 else 3 end;
  if (select count(*) from public.pair_anniversaries where pair_id=v_pair) >= v_limit then raise exception 'Anniversary quota reached'; end if;
  insert into public.pair_anniversaries(pair_id,title,event_date,note,created_by)
  values(v_pair,trim(p_title),p_event_date,trim(coalesce(p_note,'')),auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_date_record(p_date_on date,p_title text,p_place text default '',p_memory text default '')
returns uuid language plpgsql security definer
set search_path = public
as $$
declare v_pair uuid := public.my_pair_id(); v_limit integer; v_id uuid;
begin
  if v_pair is null then raise exception 'Pairing required'; end if;
  v_limit := case when public.my_pair_is_plus() then 500 else 10 end;
  if (select count(*) from public.pair_date_records where pair_id=v_pair) >= v_limit then raise exception 'Date record quota reached'; end if;
  insert into public.pair_date_records(pair_id,date_on,title,place,memory,created_by)
  values(v_pair,p_date_on,trim(p_title),trim(coalesce(p_place,'')),trim(coalesce(p_memory,'')),auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_date_wish(p_title text,p_place text default '',p_note text default '')
returns uuid language plpgsql security definer
set search_path = public
as $$
declare v_pair uuid := public.my_pair_id(); v_limit integer; v_id uuid;
begin
  if v_pair is null then raise exception 'Pairing required'; end if;
  v_limit := case when public.my_pair_is_plus() then 200 else 10 end;
  if (select count(*) from public.pair_date_wishes where pair_id=v_pair) >= v_limit then raise exception 'Date wish quota reached'; end if;
  insert into public.pair_date_wishes(pair_id,title,place,note,created_by)
  values(v_pair,trim(p_title),trim(coalesce(p_place,'')),trim(coalesce(p_note,'')),auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.set_date_wish_status(p_id uuid,p_status text)
returns void language plpgsql security definer
set search_path = public
as $$
begin
  if p_status not in ('planned','done') then raise exception 'Invalid wish status'; end if;
  update public.pair_date_wishes
    set status=p_status,completed_at=case when p_status='done' then now() else null end
    where id=p_id and pair_id=public.my_pair_id();
  if not found then raise exception 'Date wish not found'; end if;
end;
$$;

create or replace function public.reserve_album_photo(p_id uuid,p_path text,p_name text,p_size integer)
returns uuid language plpgsql security definer
set search_path = public
as $$
declare v_user uuid := auth.uid(); v_pair uuid := public.my_pair_id(); v_role text := public.my_pair_role(); v_limit integer;
begin
  if v_pair is null then raise exception 'Pairing required'; end if;
  if p_size not between 1 and 900000 then raise exception 'Photo must be 900 KB or smaller'; end if;
  v_limit := case when public.my_pair_is_plus() then 300 else 24 end;
  if (select count(*) from public.album_photos where pair_id=v_pair) >= v_limit then raise exception 'Album quota reached'; end if;
  if p_path <> (v_pair::text || '/' || p_id::text || '.jpg') then raise exception 'Invalid storage path'; end if;
  insert into public.album_photos(id,pair_id,uploader_role,uploader_user_id,path,name,byte_size)
  values(p_id,v_pair,v_role,v_user,p_path,left(coalesce(p_name,'photo.jpg'),120),p_size);
  return p_id;
end;
$$;

revoke all on public.pair_entitlements,public.iap_orders,public.pair_anniversaries,public.pair_date_records,public.pair_date_wishes from anon;
revoke all on public.iap_orders from authenticated;
grant select on public.pair_entitlements,public.pair_anniversaries,public.pair_date_records,public.pair_date_wishes to authenticated;
grant delete on public.pair_anniversaries,public.pair_date_records,public.pair_date_wishes to authenticated;

revoke all on function public.my_pair_is_plus() from public,anon;
revoke all on function public.submit_monthly_review_v2(date,jsonb,text,text,text,text,text,text,text,jsonb) from public,anon;
revoke all on function public.create_anniversary(date,text,text) from public,anon;
revoke all on function public.create_date_record(date,text,text,text) from public,anon;
revoke all on function public.create_date_wish(text,text,text) from public,anon;
revoke all on function public.set_date_wish_status(uuid,text) from public,anon;
grant execute on function public.my_pair_is_plus() to authenticated;
grant execute on function public.submit_monthly_review_v2(date,jsonb,text,text,text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.create_anniversary(date,text,text) to authenticated;
grant execute on function public.create_date_record(date,text,text,text) to authenticated;
grant execute on function public.create_date_wish(text,text,text) to authenticated;
grant execute on function public.set_date_wish_status(uuid,text) to authenticated;

-- Payment activation intentionally remains server-only. After LINE IAP review,
-- a verified webhook should write iap_orders and extend pair_entitlements.
