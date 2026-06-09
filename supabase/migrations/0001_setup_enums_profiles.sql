-- 0001: extensions, enums, updated_at helper, user profiles + role helpers.
-- All later migrations depend on this file.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type pipeline_column as enum (
  'identified','silver','gold','platinum','active_discussions',
  'due_diligence','hots','complete','reengage','dead'
);

create type deal_tier as enum ('silver','gold','platinum');

create type clinic_source as enum ('platform_import','pipedrive_import','manual');

create type contact_role as enum (
  'owner','director','practice_manager','adviser','solicitor','accountant','other'
);

create type interaction_type as enum ('email','whatsapp_day','call','meeting','note');
create type interaction_direction as enum ('inbound','outbound');
create type interaction_source as enum (
  'manual','outlook_sync','whatsapp_import','pipedrive_migration'
);

create type offer_type as enum ('verbal','ioi','loi','revised','final');
create type offer_status as enum ('made','accepted','rejected','superseded');

create type change_of_control as enum ('none','notify_only','consent_required','unknown');

create type doc_type as enum (
  'hots','spa','loan_notes','earn_out','lease','ddq',
  'employment_contracts','disclosure_letter','other'
);
create type doc_location as enum ('sharepoint','outlook','word','other');
create type doc_status as enum (
  'not_started','drafting','issued','with_sellers','marked_up','agreed','signed'
);
create type responsible_party as enum (
  'kinetico','sellers','buyer_solicitors','seller_solicitors','other'
);

create type checklist_item_status as enum ('open','in_progress','done','n/a');
create type task_status as enum ('open','done');

create type user_role as enum ('admin','deal_lead','exec','viewer');

create type sync_source as enum ('outlook','pipedrive','clinic_import','companies_house');
create type sync_status as enum ('running','success','warning','error');

create type ch_signal_type as enum ('accounts_filed','director_change','other');

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- User profiles + role helpers
-- ---------------------------------------------------------------------------
create table public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role user_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_profiles_updated
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- security definer helpers avoid RLS policy recursion (policies on
-- user_profiles would otherwise have to query user_profiles).
create or replace function public.role_of()
returns user_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.user_profiles where user_id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select role = 'admin' from public.user_profiles where user_id = auth.uid()),
    false
  );
$$;

-- admin or deal_lead: the two roles allowed to write deal data
create or replace function public.is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select role in ('admin','deal_lead') from public.user_profiles where user_id = auth.uid()),
    false
  );
$$;

alter table public.user_profiles enable row level security;

-- Every authenticated user can read profiles (names/roles power owner
-- avatars and assignment pickers); only admins mutate them.
create policy user_profiles_select on public.user_profiles
  for select to authenticated using (true);
create policy user_profiles_insert on public.user_profiles
  for insert to authenticated with check (public.is_admin());
create policy user_profiles_update on public.user_profiles
  for update to authenticated using (public.is_admin());
create policy user_profiles_delete on public.user_profiles
  for delete to authenticated using (public.is_admin());
