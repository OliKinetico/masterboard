-- ============================================================================
-- Kinetico M&A CRM — STAGING SETUP (one-shot, paste into the Supabase
-- Dashboard → SQL Editor → New query → Run)
--
-- Does everything in one pass:
--   1. resets the public schema
--   2. applies migrations 0001–0014
--   3. creates the four demo logins (password: REDACTED-ROTATE-BEFORE-USE)
--   4. loads the full deterministic seed (80 clinics, 31 deals, …) with
--      triggers paused so history/checklists/legal packs aren't duplicated
--      (the seed data already contains the trigger outputs)
--   5. re-grants API access and prints verification counts
--
-- Generated from the locally verified database. Safe to re-run: it wipes
-- and rebuilds the public schema each time (auth users are upserted).
-- ============================================================================

-- 1 ── reset public schema --------------------------------------------------
drop schema if exists public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- 2 ── migrations -------------------------------------------------------------

-- ───────────────────────── supabase/migrations/0001_setup_enums_profiles.sql ─────────────────────────
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

-- ───────────────────────── supabase/migrations/0002_clinics_contacts.sql ─────────────────────────
-- 0002: clinics, contacts, clinic_aliases (+ trigram search indexes).

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trading_name text,
  address_line1 text,
  address_line2 text,
  city text,
  postcode text,
  region text,
  lat double precision,
  lng double precision,
  companies_house_number text,
  website text,
  phone text,
  disciplines text[] not null default '{}',
  revenue_estimate numeric,
  practitioner_count int,
  sites_count int not null default 1,
  score numeric,
  source clinic_source not null default 'manual',
  platform_clinic_id text unique,
  ch_last_accounts_date date,
  merged_into_clinic_id uuid references public.clinics (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinics_disciplines_valid check (
    disciplines <@ array['Chiro','Physio','Podiatry','Osteo','Other']::text[]
  )
);

create trigger trg_clinics_updated
  before update on public.clinics
  for each row execute function public.set_updated_at();

-- trigram search: names/postcodes/CH numbers, typo-tolerant (BUILDLOG P1)
create index idx_clinics_name_trgm on public.clinics using gin (name gin_trgm_ops);
create index idx_clinics_postcode_trgm on public.clinics using gin ((coalesce(postcode,'')) gin_trgm_ops);
create index idx_clinics_ch_number on public.clinics (companies_house_number);
create index idx_clinics_region on public.clinics (region);
create index idx_clinics_merged on public.clinics (merged_into_clinic_id) where merged_into_clinic_id is not null;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics (id) on delete set null,
  full_name text not null,
  role contact_role not null default 'other',
  emails text[] not null default '{}',
  phone text,
  whatsapp_number text, -- E.164
  notes text,
  merged_into_contact_id uuid references public.contacts (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_contacts_updated
  before update on public.contacts
  for each row execute function public.set_updated_at();

create index idx_contacts_clinic on public.contacts (clinic_id);
create index idx_contacts_name_trgm on public.contacts using gin (full_name gin_trgm_ops);
-- email-address matching for the Outlook sync matcher
create index idx_contacts_emails on public.contacts using gin (emails);

-- keyword matching for the email matcher; seeded from clinic names
create table public.clinic_aliases (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, alias)
);

create trigger trg_clinic_aliases_updated
  before update on public.clinic_aliases
  for each row execute function public.set_updated_at();

create index idx_clinic_aliases_alias on public.clinic_aliases (lower(alias));

-- ───────────────────────── supabase/migrations/0003_deals.sql ─────────────────────────
-- 0003: deals, deal_clinics, stage_history, deal_access, comments.
--
-- "A clinic may appear on at most one LIVE deal": a partial unique index on
-- deal_clinics cannot see deals.pipeline_column (indexes are single-table),
-- so the rule is enforced by two triggers (ASSUMPTIONS #4):
--   1. deal_clinics insert/update — reject if the clinic already sits on
--      another live deal;
--   2. deals pipeline_column change to a live column — re-check every
--      attached clinic (reviving a dead deal must not create a conflict).

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  primary_clinic_id uuid not null references public.clinics (id),
  name text not null,
  pipeline_column pipeline_column not null default 'identified',
  tier deal_tier,
  is_live boolean generated always as (
    pipeline_column not in ('complete','dead')
  ) stored,
  first_met_on date,
  first_met_context text,
  owner_user_id uuid references auth.users (id),
  next_action text,
  next_action_due date,
  hots_signed_at timestamptz,
  reengage_on date,
  dead_reason text,
  key_info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- reengage/dead invariants live in the DB, not just the UI
  constraint deals_reengage_requires_date check (
    pipeline_column <> 'reengage' or reengage_on is not null
  ),
  constraint deals_dead_requires_reason check (
    pipeline_column <> 'dead' or (dead_reason is not null and dead_reason <> '')
  )
);

create trigger trg_deals_updated
  before update on public.deals
  for each row execute function public.set_updated_at();

create index idx_deals_column on public.deals (pipeline_column);
create index idx_deals_owner on public.deals (owner_user_id);
create index idx_deals_live on public.deals (is_live) where is_live;
create index idx_deals_name_trgm on public.deals using gin (name gin_trgm_ops);
create index idx_deals_reengage on public.deals (reengage_on) where pipeline_column = 'reengage';

create table public.deal_clinics (
  deal_id uuid not null references public.deals (id) on delete cascade,
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (deal_id, clinic_id)
);

create index idx_deal_clinics_clinic on public.deal_clinics (clinic_id);

-- trigger 1: adding a clinic to a live deal
create or replace function public.check_clinic_single_live_deal()
returns trigger
language plpgsql
as $$
declare
  conflicting uuid;
begin
  select dc.deal_id into conflicting
  from public.deal_clinics dc
  join public.deals d on d.id = dc.deal_id
  where dc.clinic_id = new.clinic_id
    and dc.deal_id <> new.deal_id
    and d.is_live
  limit 1;

  if conflicting is not null
     and exists (select 1 from public.deals where id = new.deal_id and is_live) then
    raise exception 'clinic % already belongs to live deal %', new.clinic_id, conflicting
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger trg_deal_clinics_single_live
  before insert or update on public.deal_clinics
  for each row execute function public.check_clinic_single_live_deal();

-- trigger 2: a deal coming (back) to life re-checks its clinics
create or replace function public.check_deal_revival_clinics()
returns trigger
language plpgsql
as $$
declare
  conflicting record;
begin
  if new.is_live and not old.is_live then
    select dc.clinic_id, other.deal_id as other_deal into conflicting
    from public.deal_clinics dc
    join public.deal_clinics other
      on other.clinic_id = dc.clinic_id and other.deal_id <> dc.deal_id
    join public.deals od on od.id = other.deal_id and od.is_live
    where dc.deal_id = new.id
    limit 1;

    if found then
      raise exception 'cannot revive deal: clinic % is on live deal %',
        conflicting.clinic_id, conflicting.other_deal
        using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_deals_revival_check
  before update of pipeline_column on public.deals
  for each row execute function public.check_deal_revival_clinics();

-- ---------------------------------------------------------------------------
-- stage_history: written by trigger on every column change
-- ---------------------------------------------------------------------------
create table public.stage_history (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  from_column pipeline_column,
  to_column pipeline_column not null,
  moved_by uuid references auth.users (id),
  moved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_stage_history_deal on public.stage_history (deal_id, moved_at);

create or replace function public.record_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.stage_history (deal_id, from_column, to_column, moved_by)
    values (new.id, null, new.pipeline_column, auth.uid());
  elsif new.pipeline_column is distinct from old.pipeline_column then
    insert into public.stage_history (deal_id, from_column, to_column, moved_by)
    values (new.id, old.pipeline_column, new.pipeline_column, auth.uid());
  end if;
  return new;
end;
$$;

create trigger trg_deals_stage_history
  after insert or update of pipeline_column on public.deals
  for each row execute function public.record_stage_change();

-- tier: set when entering a tier column, persists afterwards (spec §4.3);
-- leaving reengage clears reengage_on (spec §5.12)
create or replace function public.apply_column_side_effects()
returns trigger
language plpgsql
as $$
begin
  if new.pipeline_column in ('silver','gold','platinum') then
    new.tier = new.pipeline_column::text::deal_tier;
  end if;
  if tg_op = 'UPDATE'
     and old.pipeline_column = 'reengage'
     and new.pipeline_column <> 'reengage' then
    new.reengage_on = null;
  end if;
  return new;
end;
$$;

create trigger trg_deals_column_side_effects
  before insert or update of pipeline_column on public.deals
  for each row execute function public.apply_column_side_effects();

-- ---------------------------------------------------------------------------
-- viewer grants + exec comments
-- ---------------------------------------------------------------------------
create table public.deal_access (
  user_id uuid not null references auth.users (id) on delete cascade,
  deal_id uuid not null references public.deals (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, deal_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  author_user_id uuid not null references auth.users (id),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_comments_updated
  before update on public.comments
  for each row execute function public.set_updated_at();

create index idx_comments_deal on public.comments (deal_id, created_at);

-- ───────────────────────── supabase/migrations/0004_offers_properties.sql ─────────────────────────
-- 0004: offers (with generated implied multiple) and properties.

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  offer_type offer_type not null,
  made_on date not null default current_date,
  enterprise_value numeric,
  ebitda_basis numeric,
  -- null-safe generated EV/EBITDA multiple
  implied_multiple numeric generated always as (
    case
      when ebitda_basis is null or ebitda_basis = 0 then null
      else round(enterprise_value / ebitda_basis, 2)
    end
  ) stored,
  cash_pct numeric not null default 70,
  loan_note_pct numeric not null default 30,
  earn_out_summary text,
  structure_notes text,
  status offer_status not null default 'made',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offers_pcts_valid check (
    cash_pct >= 0 and loan_note_pct >= 0 and cash_pct + loan_note_pct <= 100
  )
);

create trigger trg_offers_updated
  before update on public.offers
  for each row execute function public.set_updated_at();

create index idx_offers_deal on public.offers (deal_id, made_on desc);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  clinic_id uuid references public.clinics (id) on delete set null,
  address text not null,
  leasehold boolean not null default true,
  rent_pa numeric,
  lease_start date,
  lease_expiry date,
  break_date date,
  lease_length_years numeric,
  change_of_control change_of_control not null default 'unknown',
  -- UK Land Registry: leases over 7 years must be registered. Computed as a
  -- default in the form, editable (spec §4.6 / ASSUMPTIONS #14).
  registration_required boolean not null default false,
  landlord_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_properties_updated
  before update on public.properties
  for each row execute function public.set_updated_at();

create index idx_properties_deal on public.properties (deal_id);

-- ───────────────────────── supabase/migrations/0005_interactions_tasks.sql ─────────────────────────
-- 0005: unified timeline (interactions) + tasks.
-- source_ref is THE idempotency key for every external write path
-- (Graph message id / whatsapp day-hash / pipedrive activity id): unique,
-- so imports upsert instead of duplicating (spec §1.5, §4.7).

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  occurred_on date not null,
  occurred_at timestamptz,
  type interaction_type not null,
  direction interaction_direction,
  subject text,
  summary text not null,
  body text,
  source interaction_source not null default 'manual',
  source_ref text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_interactions_updated
  before update on public.interactions
  for each row execute function public.set_updated_at();

create index idx_interactions_deal on public.interactions (deal_id, occurred_on desc);
create index idx_interactions_contact on public.interactions (contact_id);
create index idx_interactions_type on public.interactions (deal_id, type);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  title text not null,
  owner_user_id uuid references auth.users (id),
  due_on date,
  status task_status not null default 'open',
  created_from_interaction_id uuid references public.interactions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_tasks_updated
  before update on public.tasks
  for each row execute function public.set_updated_at();

create index idx_tasks_deal on public.tasks (deal_id, status);
create index idx_tasks_owner on public.tasks (owner_user_id, status);

-- ───────────────────────── supabase/migrations/0006_documents_legal.sql ─────────────────────────
-- 0006: documents, document_status_history, legal pack templates and the
-- hots_signed_at spawn trigger (spec §4.8).

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  doc_type doc_type not null,
  title text not null,
  version_label text,
  url text,
  location_hint doc_location not null default 'other',
  status doc_status not null default 'not_started',
  responsible responsible_party not null default 'kinetico',
  due_on date,
  property_id uuid references public.properties (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_documents_updated
  before update on public.documents
  for each row execute function public.set_updated_at();

create index idx_documents_deal on public.documents (deal_id);
create index idx_documents_status on public.documents (status);
create index idx_documents_due on public.documents (due_on) where status <> 'signed';

create table public.document_status_history (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  from_status doc_status,
  to_status doc_status not null,
  changed_by uuid references auth.users (id),
  changed_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

create index idx_doc_status_history_doc
  on public.document_status_history (document_id, changed_at);

create or replace function public.record_document_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.document_status_history (document_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.document_status_history (document_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger trg_documents_status_history
  after insert or update of status on public.documents
  for each row execute function public.record_document_status_change();

-- ---------------------------------------------------------------------------
-- Legal pack templates (Admin-editable). initial_status lets the seeded
-- template mark the HoTs row as signed at spawn time — by definition the
-- pack spawns the moment HoTs are signed.
-- ---------------------------------------------------------------------------
create table public.legal_pack_templates (
  id uuid primary key default gen_random_uuid(),
  doc_type doc_type not null unique,
  sort_order int not null,
  initial_status doc_status not null default 'not_started',
  default_responsible responsible_party not null default 'buyer_solicitors',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_legal_pack_templates_updated
  before update on public.legal_pack_templates
  for each row execute function public.set_updated_at();

-- Spawn: when hots_signed_at transitions null -> not null, create one
-- documents row per template entry plus one lease row per property on the
-- deal. Idempotent: skips doc_types the deal already has.
create or replace function public.spawn_legal_pack()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tmpl record;
  prop record;
begin
  if new.hots_signed_at is not null and old.hots_signed_at is null then
    for tmpl in
      select * from public.legal_pack_templates order by sort_order
    loop
      if tmpl.doc_type = 'lease' then
        continue; -- leases come from properties below
      end if;
      if not exists (
        select 1 from public.documents
        where deal_id = new.id and doc_type = tmpl.doc_type
      ) then
        insert into public.documents (deal_id, doc_type, title, status, responsible)
        values (
          new.id,
          tmpl.doc_type,
          case tmpl.doc_type
            when 'hots' then 'Heads of Terms'
            when 'spa' then 'Share Purchase Agreement'
            when 'loan_notes' then 'Loan Note Instrument'
            when 'earn_out' then 'Earn-out Agreement'
            when 'ddq' then 'Due Diligence Questionnaire'
            when 'employment_contracts' then 'Employment Contracts'
            when 'disclosure_letter' then 'Disclosure Letter'
            else initcap(replace(tmpl.doc_type::text, '_', ' '))
          end,
          tmpl.initial_status,
          tmpl.default_responsible
        );
      end if;
    end loop;

    for prop in
      select * from public.properties where deal_id = new.id
    loop
      if not exists (
        select 1 from public.documents
        where deal_id = new.id and doc_type = 'lease' and property_id = prop.id
      ) then
        insert into public.documents (deal_id, doc_type, title, status, responsible, property_id)
        values (
          new.id, 'lease',
          'Lease — ' || prop.address,
          'not_started', 'seller_solicitors', prop.id
        );
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create trigger trg_deals_spawn_legal_pack
  after update of hots_signed_at on public.deals
  for each row execute function public.spawn_legal_pack();

-- ───────────────────────── supabase/migrations/0007_checklists.sql ─────────────────────────
-- 0007: generic checklist engine (spec §4.9). Templates can bind to a
-- pipeline column; entering that column instantiates the checklist once.

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trigger_column pipeline_column,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_checklist_templates_updated
  before update on public.checklist_templates
  for each row execute function public.set_updated_at();

create table public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates (id) on delete cascade,
  title text not null,
  sort int not null default 0,
  default_responsible responsible_party not null default 'kinetico',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_checklist_template_items_updated
  before update on public.checklist_template_items
  for each row execute function public.set_updated_at();

create table public.deal_checklists (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  template_id uuid references public.checklist_templates (id) on delete set null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, template_id)
);

create trigger trg_deal_checklists_updated
  before update on public.deal_checklists
  for each row execute function public.set_updated_at();

create table public.deal_checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.deal_checklists (id) on delete cascade,
  title text not null,
  sort int not null default 0,
  status checklist_item_status not null default 'open',
  responsible responsible_party not null default 'kinetico',
  due_on date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_deal_checklist_items_updated
  before update on public.deal_checklist_items
  for each row execute function public.set_updated_at();

create index idx_deal_checklist_items_list
  on public.deal_checklist_items (checklist_id, sort);

create or replace function public.spawn_checklists_for_column()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tmpl record;
  new_checklist_id uuid;
begin
  for tmpl in
    select * from public.checklist_templates
    where trigger_column = new.pipeline_column
  loop
    if not exists (
      select 1 from public.deal_checklists
      where deal_id = new.id and template_id = tmpl.id
    ) then
      insert into public.deal_checklists (deal_id, template_id, name)
      values (new.id, tmpl.id, tmpl.name)
      returning id into new_checklist_id;

      insert into public.deal_checklist_items (checklist_id, title, sort, responsible)
      select new_checklist_id, i.title, i.sort, i.default_responsible
      from public.checklist_template_items i
      where i.template_id = tmpl.id
      order by i.sort;
    end if;
  end loop;
  return new;
end;
$$;

create trigger trg_deals_spawn_checklists
  after insert or update of pipeline_column on public.deals
  for each row execute function public.spawn_checklists_for_column();

-- ───────────────────────── supabase/migrations/0008_supporting.sql ─────────────────────────
-- 0008: supporting tables — saved views, column settings (weighted forecast
-- probabilities), sync runs (sync health), Companies House signals.

create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  page text not null,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, page, name)
);

create trigger trg_saved_views_updated
  before update on public.saved_views
  for each row execute function public.set_updated_at();

create table public.column_settings (
  pipeline_column pipeline_column primary key,
  probability numeric not null check (probability >= 0 and probability <= 1),
  sort_order int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_column_settings_updated
  before update on public.column_settings
  for each row execute function public.set_updated_at();

-- seeded defaults (spec §4.12); editable in Admin
insert into public.column_settings (pipeline_column, probability, sort_order) values
  ('identified',         0.02, 1),
  ('silver',             0.05, 2),
  ('gold',               0.10, 3),
  ('platinum',           0.20, 4),
  ('active_discussions', 0.35, 5),
  ('due_diligence',      0.60, 6),
  ('hots',               0.80, 7),
  ('complete',           1.00, 8),
  ('reengage',           0.05, 9),
  ('dead',               0.00, 10);

-- every import/sync writes exactly one row; failures must surface here
-- (spec §1.5 / §5.7 sync health)
create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source sync_source not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status sync_status not null default 'running',
  counts jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_sync_runs_updated
  before update on public.sync_runs
  for each row execute function public.set_updated_at();

create index idx_sync_runs_source on public.sync_runs (source, started_at desc);

create table public.ch_signals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  signal_type ch_signal_type not null,
  detail jsonb not null default '{}'::jsonb,
  seen_on date not null default current_date,
  acknowledged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_ch_signals_updated
  before update on public.ch_signals
  for each row execute function public.set_updated_at();

create index idx_ch_signals_clinic on public.ch_signals (clinic_id) where not acknowledged;

-- ───────────────────────── supabase/migrations/0009_rls.sql ─────────────────────────
-- 0009: row-level security for every table (spec §4.11).
--   admin      — everything
--   deal_lead  — read all; write deal-scoped data (+ clinics/contacts/aliases:
--                needed for "add sender as contact", quick-add and imports —
--                ASSUMPTIONS #16)
--   exec       — read all; write ONLY comments
--   viewer     — read only deals granted in deal_access (and child rows)
-- Helpers are security definer to avoid policy recursion.

create or replace function public.can_read_deal(p_deal_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when public.role_of() in ('admin','deal_lead','exec') then true
    when public.role_of() = 'viewer' then exists (
      select 1 from public.deal_access
      where deal_id = p_deal_id and user_id = auth.uid()
    )
    else false
  end;
$$;

-- a clinic is visible to a viewer when it sits on a granted deal
create or replace function public.can_read_clinic(p_clinic_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when public.role_of() in ('admin','deal_lead','exec') then true
    when public.role_of() = 'viewer' then exists (
      select 1
      from public.deal_access da
      join public.deals d on d.id = da.deal_id
      left join public.deal_clinics dc on dc.deal_id = d.id
      where da.user_id = auth.uid()
        and (d.primary_clinic_id = p_clinic_id or dc.clinic_id = p_clinic_id)
    )
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
alter table public.clinics enable row level security;
create policy clinics_select on public.clinics
  for select to authenticated using (public.can_read_clinic(id));
create policy clinics_write on public.clinics
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.contacts enable row level security;
create policy contacts_select on public.contacts
  for select to authenticated using (
    public.role_of() in ('admin','deal_lead','exec')
    or (clinic_id is not null and public.can_read_clinic(clinic_id))
  );
create policy contacts_write on public.contacts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.clinic_aliases enable row level security;
create policy clinic_aliases_select on public.clinic_aliases
  for select to authenticated using (public.role_of() is not null);
create policy clinic_aliases_write on public.clinic_aliases
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
alter table public.deals enable row level security;
create policy deals_select on public.deals
  for select to authenticated using (public.can_read_deal(id));
create policy deals_write on public.deals
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.deal_clinics enable row level security;
create policy deal_clinics_select on public.deal_clinics
  for select to authenticated using (public.can_read_deal(deal_id));
create policy deal_clinics_write on public.deal_clinics
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.stage_history enable row level security;
create policy stage_history_select on public.stage_history
  for select to authenticated using (public.can_read_deal(deal_id));
-- rows are written by the security definer trigger; only admins touch directly
create policy stage_history_admin on public.stage_history
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.deal_access enable row level security;
create policy deal_access_select on public.deal_access
  for select to authenticated using (public.is_admin() or user_id = auth.uid());
create policy deal_access_write on public.deal_access
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.comments enable row level security;
create policy comments_select on public.comments
  for select to authenticated using (public.can_read_deal(deal_id));
create policy comments_insert on public.comments
  for insert to authenticated with check (
    public.role_of() in ('admin','deal_lead','exec') and author_user_id = auth.uid()
  );
create policy comments_update on public.comments
  for update to authenticated
  using (public.is_admin() or author_user_id = auth.uid());
create policy comments_delete on public.comments
  for delete to authenticated
  using (public.is_admin() or author_user_id = auth.uid());

-- ---------------------------------------------------------------------------
alter table public.offers enable row level security;
create policy offers_select on public.offers
  for select to authenticated using (public.can_read_deal(deal_id));
create policy offers_write on public.offers
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.properties enable row level security;
create policy properties_select on public.properties
  for select to authenticated using (public.can_read_deal(deal_id));
create policy properties_write on public.properties
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.interactions enable row level security;
create policy interactions_select on public.interactions
  for select to authenticated using (public.can_read_deal(deal_id));
create policy interactions_write on public.interactions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.tasks enable row level security;
create policy tasks_select on public.tasks
  for select to authenticated using (public.can_read_deal(deal_id));
create policy tasks_write on public.tasks
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
alter table public.documents enable row level security;
create policy documents_select on public.documents
  for select to authenticated using (public.can_read_deal(deal_id));
create policy documents_write on public.documents
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.document_status_history enable row level security;
create policy doc_status_history_select on public.document_status_history
  for select to authenticated using (
    exists (
      select 1 from public.documents d
      where d.id = document_id and public.can_read_deal(d.deal_id)
    )
  );
create policy doc_status_history_admin on public.document_status_history
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.legal_pack_templates enable row level security;
create policy legal_pack_templates_select on public.legal_pack_templates
  for select to authenticated using (public.role_of() is not null);
create policy legal_pack_templates_write on public.legal_pack_templates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
alter table public.checklist_templates enable row level security;
create policy checklist_templates_select on public.checklist_templates
  for select to authenticated using (public.role_of() is not null);
create policy checklist_templates_write on public.checklist_templates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.checklist_template_items enable row level security;
create policy checklist_template_items_select on public.checklist_template_items
  for select to authenticated using (public.role_of() is not null);
create policy checklist_template_items_write on public.checklist_template_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.deal_checklists enable row level security;
create policy deal_checklists_select on public.deal_checklists
  for select to authenticated using (public.can_read_deal(deal_id));
create policy deal_checklists_write on public.deal_checklists
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.deal_checklist_items enable row level security;
create policy deal_checklist_items_select on public.deal_checklist_items
  for select to authenticated using (
    exists (
      select 1 from public.deal_checklists c
      where c.id = checklist_id and public.can_read_deal(c.deal_id)
    )
  );
create policy deal_checklist_items_write on public.deal_checklist_items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
alter table public.saved_views enable row level security;
create policy saved_views_own on public.saved_views
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.column_settings enable row level security;
create policy column_settings_select on public.column_settings
  for select to authenticated using (public.role_of() is not null);
create policy column_settings_write on public.column_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.sync_runs enable row level security;
create policy sync_runs_select on public.sync_runs
  for select to authenticated using (public.role_of() in ('admin','deal_lead','exec'));
create policy sync_runs_write on public.sync_runs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

alter table public.ch_signals enable row level security;
create policy ch_signals_select on public.ch_signals
  for select to authenticated using (public.role_of() in ('admin','deal_lead','exec'));
create policy ch_signals_write on public.ch_signals
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ───────────────────────── supabase/migrations/0010_seed_templates.sql ─────────────────────────
-- 0010: reference data that must always exist (Admin-editable afterwards):
-- the legal pack template and the Due Diligence Pack checklist template.

insert into public.legal_pack_templates (doc_type, sort_order, initial_status, default_responsible) values
  ('hots',                 1, 'signed',      'kinetico'),         -- pack spawns when HoTs sign — mark signed
  ('spa',                  2, 'not_started', 'buyer_solicitors'),
  ('loan_notes',           3, 'not_started', 'buyer_solicitors'),
  ('earn_out',             4, 'not_started', 'buyer_solicitors'),
  ('ddq',                  5, 'not_started', 'sellers'),
  ('employment_contracts', 6, 'not_started', 'sellers'),
  ('disclosure_letter',    7, 'not_started', 'seller_solicitors');

with tmpl as (
  insert into public.checklist_templates (name, trigger_column)
  values ('Due Diligence Pack', 'due_diligence')
  returning id
)
insert into public.checklist_template_items (template_id, title, sort, default_responsible)
select tmpl.id, v.title, v.sort, v.responsible::responsible_party
from tmpl,
(values
  ('Financial DD (QoE)',                          1, 'kinetico'),
  ('Legal DD',                                    2, 'buyer_solicitors'),
  ('Property & leases review',                    3, 'buyer_solicitors'),
  ('Clinical/regulatory (CQC, HTM 01-05, IRMER)', 4, 'kinetico'),
  ('Employment & contractors',                    5, 'sellers'),
  ('IT & data',                                   6, 'kinetico'),
  ('Insurance',                                   7, 'sellers')
) as v(title, sort, responsible);

-- ───────────────────────── supabase/migrations/0011_unmatched_emails.sql ─────────────────────────
-- 0011: Unmatched Inbox (spec §5.7 matcher step 3). Synced messages that
-- matched no contact address and no clinic alias land here for one-tap
-- assignment; assigning creates the interaction (+ optionally the contact).

create type unmatched_email_status as enum ('pending','assigned','dismissed');

create table public.unmatched_emails (
  id uuid primary key default gen_random_uuid(),
  graph_id text not null unique,
  from_name text,
  from_address text not null,
  to_addresses text[] not null default '{}',
  subject text,
  body_preview text,
  body text,
  received_at timestamptz not null,
  attachments jsonb not null default '[]'::jsonb,
  status unmatched_email_status not null default 'pending',
  assigned_deal_id uuid references public.deals (id) on delete set null,
  assigned_interaction_id uuid references public.interactions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_unmatched_emails_updated
  before update on public.unmatched_emails
  for each row execute function public.set_updated_at();

create index idx_unmatched_emails_pending
  on public.unmatched_emails (received_at desc) where status = 'pending';

alter table public.unmatched_emails enable row level security;
create policy unmatched_emails_select on public.unmatched_emails
  for select to authenticated using (public.role_of() in ('admin','deal_lead','exec'));
create policy unmatched_emails_write on public.unmatched_emails
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ───────────────────────── supabase/migrations/0012_deal_card_info.sql ─────────────────────────
-- 0012: per-deal derived card data for the kanban/list/analytics surfaces.
-- security_invoker so RLS on deals/offers/stage_history applies to the caller.

create view public.deal_card_info
with (security_invoker = true) as
select
  d.id as deal_id,
  (
    select o.enterprise_value
    from public.offers o
    where o.deal_id = d.id and o.status in ('made','accepted')
    order by o.made_on desc, o.created_at desc
    limit 1
  ) as latest_offer_ev,
  (
    select max(sh.moved_at)
    from public.stage_history sh
    where sh.deal_id = d.id
  ) as last_stage_change_at,
  (
    select max(i.occurred_on)
    from public.interactions i
    where i.deal_id = d.id
  ) as last_interaction_on
from public.deals d;

-- ───────────────────────── supabase/migrations/0013_whatsapp_sync_source.sql ─────────────────────────
-- 0013: WhatsApp imports write reconciliation rows to sync_runs too
-- (spec §1.5: every import produces a reconciliation count).
alter type sync_source add value if not exists 'whatsapp';

-- ───────────────────────── supabase/migrations/0014_imports_support.sql ─────────────────────────
-- 0014: import idempotency keys + merge audit.
-- Spec §1.5: external IDs are unique keys; upsert, never blind-insert.
-- Pipedrive entities need stable keys on clinics/contacts/deals (interactions
-- already key on source_ref).

alter table public.contacts add column pipedrive_person_id text unique;
alter table public.deals add column pipedrive_deal_id text unique;
-- orgs reuse clinics.platform_clinic_id (unique) with a "pd-org-" prefix

-- merge tool audit (spec §5.11: "audited")
create table public.merge_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('clinic','contact')),
  kept_id uuid not null,
  merged_id uuid not null,
  performed_by uuid references auth.users (id),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.merge_log enable row level security;
create policy merge_log_select on public.merge_log
  for select to authenticated using (public.role_of() in ('admin','deal_lead','exec'));
create policy merge_log_write on public.merge_log
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 3 ── demo logins (GoTrue-compatible inserts; password REDACTED-ROTATE-BEFORE-USE) ------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values
  ('00000000-0000-0000-0000-000000000000','54786622-76b3-4642-aeef-d73aaba847c8','authenticated','authenticated','admin@kinetico.test',  crypt('REDACTED-ROTATE-BEFORE-USE', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','19fca03c-771e-4ac8-ba7d-2108e7c73832','authenticated','authenticated','lead@kinetico.test',   crypt('REDACTED-ROTATE-BEFORE-USE', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','4317c135-902c-484e-8527-f4e0846df578','authenticated','authenticated','exec@kinetico.test',   crypt('REDACTED-ROTATE-BEFORE-USE', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','9949d473-c565-45b2-94f7-982765c53ec5','authenticated','authenticated','viewer@kinetico.test', crypt('REDACTED-ROTATE-BEFORE-USE', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb, now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', u.id::text, now(), now(), now()
from auth.users u
where u.email in ('admin@kinetico.test','lead@kinetico.test','exec@kinetico.test','viewer@kinetico.test')
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- 4 ── seed data --------------------------------------------------------------
-- reference rows created by the migrations are replaced by the dump below
-- (ids must match the seed's foreign keys)
delete from public.checklist_template_items;
delete from public.checklist_templates;
delete from public.legal_pack_templates;
delete from public.column_settings;

-- pause user + FK triggers: the dump already CONTAINS all trigger outputs
-- (stage history, spawned checklists, legal packs, status history)
set session_replication_role = replica;

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: clinics; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.clinics VALUES
	('547de6b4-2f2d-4eb0-82fc-8e47a71038cf', 'Riverside Physio — Richmond', 'Riverside Physio', '14 Thames Quay', NULL, 'Richmond', 'TW9 1HH', 'London', 51.461, -0.304, '08412231', 'https://www.riversidephysiorichmond.co.uk', NULL, '{Physio}', 720000, 9, 1, 92, 'manual', NULL, '2025-09-30', NULL, '2026-06-10 18:01:40.850304+00', '2026-06-10 18:01:40.850304+00'),
	('482b3ccd-ecc9-4c42-b416-3c7d219d8010', 'Riverside Physio — Kingston', 'Riverside Physio', '3 Market Place', NULL, 'Kingston upon Thames', 'KT1 1JT', 'London', 51.409, -0.306, '08412231', 'https://www.riversidephysiokingston.co.uk', NULL, '{Physio}', 540000, 7, 1, 90, 'manual', NULL, '2025-09-30', NULL, '2026-06-10 18:01:40.861628+00', '2026-06-10 18:01:40.861628+00'),
	('f028b708-3931-481d-a5e7-59689d71ead1', 'Riverside Physio — Putney', 'Riverside Physio', '88 Lower Richmond Road', NULL, 'Putney', 'SW15 1LN', 'London', 51.466, -0.221, '08412231', 'https://www.riversidephysioputney.co.uk', NULL, '{Physio,Podiatry}', 360000, 5, 1, 88, 'manual', NULL, '2025-09-30', NULL, '2026-06-10 18:01:40.866932+00', '2026-06-10 18:01:40.866932+00'),
	('c17d2dba-ba1e-4b82-8670-63e0c888e1e8', 'Harborne Spine & Sport', NULL, '212 High Street', NULL, 'Birmingham', 'B17 9PT', 'West Midlands', 52.46, -1.949, '10583321', 'https://www.harbornespinesport.co.uk', NULL, '{Chiro,Physio}', 880000, 11, 1, 86, 'manual', NULL, '2025-12-31', NULL, '2026-06-10 18:01:40.871947+00', '2026-06-10 18:01:40.871947+00'),
	('f89a374d-bb7d-4944-8554-9e8e92d9886e', 'Caledonia Physio Partners', NULL, '41 Constitution Street', NULL, 'Edinburgh', 'EH6 7BG', 'Scotland', 55.974, -3.17, 'SC332871', 'https://www.caledoniaphysiopartners.co.uk', NULL, '{Physio}', 1150000, 14, 2, 84, 'manual', NULL, '2025-08-31', NULL, '2026-06-10 18:01:40.877132+00', '2026-06-10 18:01:40.877132+00'),
	('13131a80-0527-472f-81c4-fcf129de7b28', 'Albion MSK Clinic', NULL, '9 Deansgate Mews', NULL, 'Manchester', 'M3 4LQ', 'North West', 53.479, -2.249, '11220987', 'https://www.albionmskclinic.co.uk', NULL, '{Physio,Osteo}', 640000, 8, 1, 81, 'manual', NULL, '2025-10-31', NULL, '2026-06-10 18:01:40.88171+00', '2026-06-10 18:01:40.88171+00'),
	('9ca6913c-efa9-4b1c-af56-8be984160382', 'Westbourne Osteopathy', NULL, '5 Poole Hill', NULL, 'Bournemouth', 'BH2 5PS', 'South West', 50.719, -1.887, '07556012', 'https://www.westbourneosteopathy.co.uk', NULL, '{Osteo}', 420000, 6, 1, 78, 'manual', NULL, '2025-06-30', NULL, '2026-06-10 18:01:40.886674+00', '2026-06-10 18:01:40.886674+00'),
	('74155a6e-57d0-49a8-8997-39d34c7c8dc5', 'The Pennine Physio Co.', NULL, '27 Otley Road', NULL, 'Leeds', 'LS6 3AA', 'Yorkshire', 53.82, -1.577, '09887234', 'https://www.thepenninephysioco.co.uk', NULL, '{Physio}', 530000, 7, 1, 74, 'manual', NULL, '2025-11-30', NULL, '2026-06-10 18:01:40.890603+00', '2026-06-10 18:01:40.890603+00'),
	('8ff9c0ad-0f6c-4d26-871d-df56c041ffd5', 'Cathedral Physiotherapy', NULL, '2 Cathedral Yard', NULL, 'Exeter', 'EX1 1HJ', 'South West', 50.722, -3.53, '06743110', 'https://www.cathedralphysiotherapy.co.uk', NULL, '{Physio}', 610000, 8, 1, 80, 'manual', NULL, '2025-07-31', NULL, '2026-06-10 18:01:40.896539+00', '2026-06-10 18:01:40.896539+00'),
	('7060c253-7c0f-4118-9a90-cd65eb1514d7', 'Granite City Physio', NULL, '118 Union Street', NULL, 'Aberdeen', 'AB10 1QR', 'Scotland', 57.146, -2.106, 'SC401177', 'https://www.granitecityphysio.co.uk', NULL, '{Physio}', 350000, 5, 1, 60, 'manual', NULL, '2025-05-31', NULL, '2026-06-10 18:01:40.899069+00', '2026-06-10 18:01:40.899069+00'),
	('2ab4c7c8-83f7-46ea-b141-67191d84f5c3', 'Severn Sports Therapy', NULL, 'Unit 4, Docks Way', NULL, 'Gloucester', 'GL1 2EH', 'South West', 51.862, -2.249, '12099813', 'https://www.severnsportstherapy.co.uk', NULL, '{Physio,Other}', 470000, 6, 1, 72, 'manual', NULL, '2026-01-31', NULL, '2026-06-10 18:01:40.9022+00', '2026-06-10 18:01:40.9022+00'),
	('676b8459-cbe9-4757-9c98-2a87f6bdb812', 'Maple House Chiropractic', NULL, '61 Mansfield Road', NULL, 'Nottingham', 'NG1 3FN', 'East Midlands', 52.958, -1.15, '10778452', 'https://www.maplehousechiropractic.co.uk', NULL, '{Chiro}', 380000, 4, 1, 69, 'manual', NULL, '2025-10-31', NULL, '2026-06-10 18:01:40.906872+00', '2026-06-10 18:01:40.906872+00'),
	('66f8a271-45f3-45aa-9791-9ae97d1ca766', 'Oakfield Chiropractic Clinic', NULL, '119 High Street', NULL, 'Bristol', 'BS8 7BB', 'South West', 51.43186937712133, -2.587680850792676, NULL, 'https://www.oakfieldchiropracticclin.co.uk', NULL, '{Chiro}', 1140000, 13, 1, 70, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:40.911096+00', '2026-06-10 18:01:40.911096+00'),
	('9f0739d3-5a83-4575-b718-434f280c8bb5', 'Stonebridge Physio Clinic', NULL, '93 High Street', NULL, 'Glasgow', 'G1 8TQ', 'Scotland', 55.8548649973236, -4.248164006676525, '06069745', 'https://www.stonebridgephysioclinic.co.uk', NULL, '{Physio}', 2200000, 24, 1, 61, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:40.915183+00', '2026-06-10 18:01:40.915183+00'),
	('4e7d14ca-3c89-439d-8100-2f6471e69a08', 'Vital Chiropractic Clinic', NULL, '33 Victoria Road', NULL, 'Chester', 'CH1 2BB', 'North West', 53.220865091681475, -2.885168754477054, NULL, 'https://www.vitalchiropracticclinic.co.uk', NULL, '{Chiro,Physio}', 1260000, 14, 1, 80, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:40.925685+00', '2026-06-10 18:01:40.925685+00'),
	('c0b4b841-77da-4592-a489-e756d7a74e4a', 'Fairview Osteopathic Practice', NULL, '184 Victoria Road', NULL, 'Dundee', 'DD1 7AA', 'Scotland', 56.42739129792899, -2.9305412519536915, NULL, 'https://www.fairviewosteopathicpract.co.uk', NULL, '{Osteo}', 2340000, 26, 1, 77, 'platform_import', NULL, '2025-06-28', NULL, '2026-06-10 18:01:40.92969+00', '2026-06-10 18:01:40.92969+00'),
	('cc5b4c38-5744-4a6e-9f61-4d674181de69', 'Anchor Foot & Ankle Clinic', NULL, '147 Station Road', NULL, 'Ipswich', 'IP1 1JL', 'East of England', 52.09559683052823, 1.1874596887640654, '09770435', 'https://www.anchorfootankleclinic.co.uk', NULL, '{Podiatry}', 310000, 3, 1, 47, 'platform_import', NULL, '2025-11-28', NULL, '2026-06-10 18:01:40.935361+00', '2026-06-10 18:01:40.935361+00'),
	('ad5d678a-7968-4e56-88a0-b2afac88f266', 'Summit Chiropractic Clinic', NULL, '195 Church Lane', NULL, 'York', 'YO1 3BB', 'Yorkshire', 53.994950621314345, -1.1069060235470534, '08376231', 'https://www.summitchiropracticclinic.co.uk', NULL, '{Chiro}', 350000, 4, 1, 58, 'platform_import', NULL, '2025-01-28', NULL, '2026-06-10 18:01:40.938654+00', '2026-06-10 18:01:40.938654+00'),
	('21125523-2ae9-451a-a2c4-4f1222dab67e', 'Ironbridge Foot & Ankle Clinic', NULL, '100 High Street', NULL, 'Guildford', 'GU1 9DX', 'South East', 51.21887859500945, -0.5985258887708187, '07251223', 'https://www.ironbridgefootankleclini.co.uk', NULL, '{Podiatry}', 190000, 2, 1, 37, 'platform_import', NULL, '2025-02-28', NULL, '2026-06-10 18:01:40.942117+00', '2026-06-10 18:01:40.942117+00'),
	('41ccf277-a5e0-4d59-bf34-7a645c7cc8a3', 'Kingsway Chiropractic Clinic', NULL, '16 Market Square', NULL, 'Liverpool', 'L1 3PR', 'North West', 53.380604088082904, -2.9520438244007527, NULL, 'https://www.kingswaychiropracticclin.co.uk', NULL, '{Chiro,Podiatry}', 290000, 3, 1, 53, 'platform_import', NULL, '2025-09-28', NULL, '2026-06-10 18:01:40.946802+00', '2026-06-10 18:01:40.946802+00'),
	('eef6c4ea-3bf5-40f9-8fe0-d6ea22b5515f', 'Foxglove Physiotherapy', NULL, '129 High Street', NULL, 'London', 'N1 2PR', 'London', 51.502313361149284, -0.06905368637293577, '08837615', 'https://www.foxglovephysiotherapy.co.uk', NULL, '{Physio}', 1140000, 13, 1, 37, 'platform_import', NULL, '2025-04-28', NULL, '2026-06-10 18:01:40.949873+00', '2026-06-10 18:01:40.949873+00'),
	('007ac3f9-7c3f-4791-be07-9d6b6153caee', 'Summit Osteopathic Practice', NULL, '9 Market Square', NULL, 'Croydon', 'CR0 2AA', 'London', 51.338906441610305, -0.12385776918381453, '08100300', 'https://www.summitosteopathicpractic.co.uk', NULL, '{Osteo}', 1630000, 18, 1, 82, 'platform_import', NULL, '2025-09-28', NULL, '2026-06-10 18:01:40.95235+00', '2026-06-10 18:01:40.95235+00'),
	('32c54111-7ab8-43a4-8037-8fe8dd3a17d0', 'Quayside Foot & Ankle Clinic', NULL, '18 Market Square', NULL, 'Cardiff', 'CF10 5AA', 'Wales', 51.45034192886203, -3.148736081849784, '06345039', 'https://www.quaysidefootankleclinic.co.uk', NULL, '{Podiatry}', 660000, 7, 1, 46, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:40.956914+00', '2026-06-10 18:01:40.956914+00'),
	('0240efe9-ec87-4037-b00f-9b4ede3fa4b0', 'Clearwater Podiatry', NULL, '22 High Street', NULL, 'Glasgow', 'G1 2TQ', 'Scotland', 55.821598782502114, -4.266541109774262, NULL, 'https://www.clearwaterpodiatry.co.uk', NULL, '{Podiatry}', 1400000, 16, 1, 33, 'platform_import', NULL, '2025-04-28', NULL, '2026-06-10 18:01:40.960933+00', '2026-06-10 18:01:40.960933+00'),
	('be05f157-9b16-4c5e-b0f2-b822cb3d5b60', 'Vital Health Clinic', NULL, '34 Mill Lane', NULL, 'Dundee', 'DD1 7JL', 'Scotland', 56.46861685698852, -2.954812518693507, '08132866', 'https://www.vitalhealthclinic.co.uk', NULL, '{Other}', 2350000, 26, 1, 49, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:40.963656+00', '2026-06-10 18:01:40.963656+00'),
	('93c2c556-44d6-41ba-b57f-1b5e0ba7d454', 'Motion Chiropractic', NULL, '48 Mill Lane', NULL, 'Croydon', 'CR0 9JL', 'London', 51.359709765519945, -0.0658428379893303, '07273537', 'https://www.motionchiropractic.co.uk', NULL, '{Chiro}', 2110000, 23, 1, 51, 'platform_import', NULL, '2025-07-28', NULL, '2026-06-10 18:01:40.96741+00', '2026-06-10 18:01:40.96741+00'),
	('86cf1ec6-c891-468c-873b-c2325d36d9ac', 'Waverley Physio Clinic', NULL, '104 Station Road', NULL, 'Cardiff', 'CF10 9TQ', 'Wales', 51.49958294028416, -3.197498410250992, '07425108', 'https://www.waverleyphysioclinic.co.uk', NULL, '{Physio}', 2040000, 23, 1, 36, 'platform_import', NULL, '2025-03-28', NULL, '2026-06-10 18:01:40.972013+00', '2026-06-10 18:01:40.972013+00'),
	('43451731-48f0-4fc6-9e98-22f9394d7098', 'Hawthorn MSK Clinic', NULL, '75 Victoria Road', NULL, 'Newcastle', 'NE1 8TQ', 'North East', 55.004319674726574, -1.574950192309916, NULL, 'https://www.hawthornmskclinic.co.uk', NULL, '{Physio}', 1240000, 14, 1, 91, 'platform_import', NULL, '2025-09-28', NULL, '2026-06-10 18:01:40.975878+00', '2026-06-10 18:01:40.975878+00'),
	('f5856934-85cb-4f3e-8a28-cd64ab6c80d2', 'Hawthorn Physio Clinic', NULL, '137 High Street', NULL, 'Sheffield', 'S1 5EH', 'Yorkshire', 53.402908137738706, -1.4875803514756263, NULL, 'https://www.hawthornphysioclinic.co.uk', NULL, '{Physio,Other}', 280000, 3, 1, 62, 'platform_import', NULL, '2025-09-28', NULL, '2026-06-10 18:01:40.980799+00', '2026-06-10 18:01:40.980799+00'),
	('07e8c8d5-d980-4d48-98c5-1024756e626f', 'Northgate Osteopathic Practice', NULL, '59 Market Square', NULL, 'Dundee', 'DD1 8TQ', 'Scotland', 56.46004614200443, -2.9845996434614066, '08161018', 'https://www.northgateosteopathicprac.co.uk', NULL, '{Osteo}', 1000000, 11, 1, 32, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:40.987743+00', '2026-06-10 18:01:40.987743+00'),
	('057f7e81-be41-497e-ac99-204310fb4ed4', 'Fairview Chiropractic Clinic', NULL, '119 Mill Lane', NULL, 'Chester', 'CH1 2EH', 'North West', 53.19154467565939, -2.8788333218172193, NULL, 'https://www.fairviewchiropracticclin.co.uk', NULL, '{Chiro}', 1750000, 19, 1, 56, 'platform_import', NULL, '2025-06-28', NULL, '2026-06-10 18:01:40.992498+00', '2026-06-10 18:01:40.992498+00'),
	('20af211a-9965-4d21-b7c3-d733efa4090f', 'Silverdale Rehab Centre', NULL, '168 Victoria Road', NULL, 'Liverpool', 'L1 1TQ', 'North West', 53.38649533169344, -3.0099446288868785, '07381117', 'https://www.silverdalerehabcentre.co.uk', NULL, '{Other}', 1240000, 14, 1, 58, 'platform_import', NULL, '2025-09-28', NULL, '2026-06-10 18:01:40.996838+00', '2026-06-10 18:01:40.996838+00'),
	('5f411982-de5f-4b88-a7d6-32c89febae8f', 'Clearwater Chiropractic', NULL, '50 Victoria Road', NULL, 'Norwich', 'NR2 3BB', 'East of England', 52.66413849975914, 1.3269907476939262, '09903837', 'https://www.clearwaterchiropractic.co.uk', NULL, '{Chiro}', 520000, 6, 1, 93, 'platform_import', NULL, '2025-06-28', NULL, '2026-06-10 18:01:41.005721+00', '2026-06-10 18:01:41.005721+00'),
	('3dbaaf83-2b65-4cd4-9441-2b95c322c89f', 'Birchwood MSK Clinic', NULL, '5 Market Square', NULL, 'Guildford', 'GU1 2BB', 'South East', 51.227624430302534, -0.5946333301253617, '12350177', 'https://www.birchwoodmskclinic.co.uk', NULL, '{Physio}', 1680000, 19, 1, 36, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.008244+00', '2026-06-10 18:01:41.008244+00'),
	('217e7b9f-e852-468e-84b4-2edb3944a11d', 'Kingsway Osteopathy', NULL, '161 Victoria Road', NULL, 'Swansea', 'SA1 2PR', 'Wales', 51.59768555441871, -3.9569954506680367, '12577100', 'https://www.kingswayosteopathy.co.uk', NULL, '{Osteo,Physio}', 630000, 7, 1, 81, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.011831+00', '2026-06-10 18:01:41.011831+00'),
	('9786b323-88db-4aac-bf71-8e3c80f6aac8', 'Summit Rehab Centre', NULL, '115 Church Lane', NULL, 'Cardiff', 'CF10 1JL', 'Wales', 51.481641326919195, -3.166720781568438, '12130652', 'https://www.summitrehabcentre.co.uk', NULL, '{Other}', 650000, 7, 1, 47, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.014998+00', '2026-06-10 18:01:41.014998+00'),
	('d8a7125f-0fc2-4397-9fff-1e02250793e0', 'Ironbridge Rehab Centre', NULL, '28 Station Road', NULL, 'Chester', 'CH1 7JL', 'North West', 53.227373098265375, -2.868337145689875, NULL, 'https://www.ironbridgerehabcentre.co.uk', NULL, '{Other}', 490000, 5, 1, 35, 'platform_import', NULL, '2025-11-28', NULL, '2026-06-10 18:01:41.022325+00', '2026-06-10 18:01:41.022325+00'),
	('0795b7e8-6c40-4139-824f-42412d75f645', 'Stonebridge Sports Physio', NULL, '1 High Street', NULL, 'Preston', 'PR1 9PR', 'North West', 53.765031359940764, -2.713991990424693, '06481689', 'https://www.stonebridgesportsphysio.co.uk', NULL, '{Physio}', 850000, 9, 1, 71, 'platform_import', NULL, '2025-04-28', NULL, '2026-06-10 18:01:41.026628+00', '2026-06-10 18:01:41.026628+00'),
	('0dd6dba5-52b9-405a-b5cd-6b7d67330030', 'Motion Sports Physio', NULL, '180 Victoria Road', NULL, 'Bath', 'BA1 6TQ', 'South West', 51.38837503332645, -2.3900820786505936, '10964624', 'https://www.motionsportsphysio.co.uk', NULL, '{Physio}', 1270000, 14, 1, 64, 'platform_import', NULL, '2025-10-28', NULL, '2026-06-10 18:01:41.030197+00', '2026-06-10 18:01:41.030197+00'),
	('642b64d8-278f-4ed2-b23e-1f118c7ab6c6', 'Greenway Sports Physio', NULL, '22 Mill Lane', NULL, 'Ipswich', 'IP1 1PR', 'East of England', 52.069301873128865, 1.1123857112973927, '09057935', 'https://www.greenwaysportsphysio.co.uk', NULL, '{Physio}', 2000000, 22, 1, 43, 'platform_import', NULL, '2025-08-28', NULL, '2026-06-10 18:01:41.033245+00', '2026-06-10 18:01:41.033245+00'),
	('b7ab84a6-22da-4a2f-a5b7-bfd75be6b82d', 'Foxglove Chiropractic', NULL, '192 Mill Lane', NULL, 'Bath', 'BA1 4BB', 'South West', 51.36757664306089, -2.339587239138782, '07534592', 'https://www.foxglovechiropractic.co.uk', NULL, '{Chiro}', 2100000, 23, 1, 92, 'platform_import', NULL, '2025-09-28', NULL, '2026-06-10 18:01:41.039217+00', '2026-06-10 18:01:41.039217+00'),
	('a520b434-6e76-48c8-ad4a-808e287c289d', 'Birchwood Osteopathy', NULL, '138 Mill Lane', NULL, 'Reading', 'RG1 6PR', 'South East', 51.457067346926785, -1.009468241352588, '12601026', 'https://www.birchwoodosteopathy.co.uk', NULL, '{Osteo}', 390000, 4, 1, 85, 'platform_import', NULL, '2025-03-28', NULL, '2026-06-10 18:01:41.042487+00', '2026-06-10 18:01:41.042487+00'),
	('5215d92b-8748-47b1-a893-b0a566ff4b0d', 'Greenway Podiatry', NULL, '90 Victoria Road', NULL, 'Bath', 'BA1 3PR', 'South West', 51.398929613661025, -2.392984209358692, '10817775', 'https://www.greenwaypodiatry.co.uk', NULL, '{Podiatry}', 1110000, 12, 1, 74, 'platform_import', NULL, '2025-09-28', NULL, '2026-06-10 18:01:41.04506+00', '2026-06-10 18:01:41.04506+00'),
	('d76fd0c2-d7bc-42bd-9e7a-d17dbaeaf9f7', 'Oakfield Osteopathic Practice', NULL, '116 Church Lane', NULL, 'Cambridge', 'CB1 7PR', 'East of England', 52.186296109929685, 0.11235257556661964, '11488764', 'https://www.oakfieldosteopathicpract.co.uk', NULL, '{Osteo}', 2210000, 25, 1, 95, 'platform_import', NULL, '2025-03-28', NULL, '2026-06-10 18:01:41.047157+00', '2026-06-10 18:01:41.047157+00'),
	('a259409f-6c7e-43eb-9d7f-b5f675b3968f', 'Foxglove Physio Clinic', NULL, '46 Church Lane', NULL, 'Norwich', 'NR2 6BB', 'East of England', 52.59859159255401, 1.270273161418736, '07912612', 'https://www.foxglovephysioclinic.co.uk', NULL, '{Physio}', 1060000, 12, 1, 42, 'platform_import', NULL, '2025-11-28', NULL, '2026-06-10 18:01:41.051478+00', '2026-06-10 18:01:41.051478+00'),
	('5ee099ae-707a-491c-bc5e-ac7a3438bb67', 'Foxglove Health Clinic', NULL, '93 Victoria Road', NULL, 'Glasgow', 'G1 2BB', 'Scotland', 55.83248563237488, -4.2642604364641015, '06325483', 'https://www.foxglovehealthclinic.co.uk', NULL, '{Other}', 2420000, 27, 1, 77, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.054535+00', '2026-06-10 18:01:41.054535+00'),
	('44f017c1-875f-46de-84de-275d200b17c6', 'Redwood MSK Clinic', NULL, '198 Market Square', NULL, 'Newcastle', 'NE1 7DX', 'North East', 54.97705513447523, -1.5804001213237644, NULL, 'https://www.redwoodmskclinic.co.uk', NULL, '{Physio,Podiatry}', 2260000, 25, 1, 45, 'platform_import', NULL, '2025-09-28', NULL, '2026-06-10 18:01:41.058666+00', '2026-06-10 18:01:41.058666+00'),
	('d457a649-c169-41cb-9cdd-6566922d481f', 'Trinity Podiatry', NULL, '141 Victoria Road', NULL, 'Bath', 'BA1 9AA', 'South West', 51.34584890495986, -2.370703265815973, '07118236', 'https://www.trinitypodiatry.co.uk', NULL, '{Podiatry}', 1710000, 19, 1, 61, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.063079+00', '2026-06-10 18:01:41.063079+00'),
	('02e8c30a-927e-4b5a-88b7-d90ca9ab83bd', 'Silverdale MSK Clinic', NULL, '7 Market Square', NULL, 'Durham', 'DH1 5TQ', 'North East', 54.804780183024704, -1.5927911956980825, '06983809', 'https://www.silverdalemskclinic.co.uk', NULL, '{Physio}', 2330000, 26, 1, 70, 'platform_import', NULL, '2025-11-28', NULL, '2026-06-10 18:01:41.065432+00', '2026-06-10 18:01:41.065432+00'),
	('37fdc85d-44fb-419d-9eaa-c1bf648740bd', 'Northgate Rehab Centre', NULL, '162 Victoria Road', NULL, 'Brighton', 'BN1 3EH', 'South East', 50.78627972284332, -0.13911357065662744, '07534281', 'https://www.northgaterehabcentre.co.uk', NULL, '{Other}', 1670000, 19, 1, 65, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.068835+00', '2026-06-10 18:01:41.068835+00');
INSERT INTO public.clinics VALUES
	('4e583df0-6a47-4bb5-b6ac-37c95423d300', 'Apex Chiropractic Clinic', NULL, '157 Station Road', NULL, 'Wolverhampton', 'WV1 4JL', 'West Midlands', 52.567524614464496, -2.1098866126313807, NULL, 'https://www.apexchiropracticclinic.co.uk', NULL, '{Chiro,Physio}', 2240000, 25, 1, 48, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.072131+00', '2026-06-10 18:01:41.072131+00'),
	('9a58f5a2-e8e5-4dc2-be71-4835639a3de7', 'Greenway Health Clinic', NULL, '58 Church Lane', NULL, 'Glasgow', 'G1 9AA', 'Scotland', 55.88174156844616, -4.288630174845457, '09484456', 'https://www.greenwayhealthclinic.co.uk', NULL, '{Other}', 310000, 3, 1, 38, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.080741+00', '2026-06-10 18:01:41.080741+00'),
	('43b0bbeb-8edd-4a48-a223-4cd0927b222f', 'Beacon Health Clinic', NULL, '162 Mill Lane', NULL, 'London', 'SE22 7AA', 'London', 51.41412417743355, -0.032767169214785105, '08744495', 'https://www.beaconhealthclinic.co.uk', NULL, '{Other}', 270000, 3, 1, 42, 'platform_import', NULL, '2025-05-28', NULL, '2026-06-10 18:01:41.08487+00', '2026-06-10 18:01:41.08487+00'),
	('ae60f951-eb63-40f7-8157-aed7cf32b6de', 'Waverley Podiatry', NULL, '155 Church Lane', NULL, 'Chester', 'CH1 7BB', 'North West', 53.19527643727138, -2.8750940186157825, '08357207', 'https://www.waverleypodiatry.co.uk', NULL, '{Podiatry}', 2310000, 26, 1, 63, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.088141+00', '2026-06-10 18:01:41.088141+00'),
	('454ef13a-4dee-42b5-a177-2c5ba9da2371', 'Waverley Osteopathic Practice', NULL, '130 Church Lane', NULL, 'London', 'N1 4TQ', 'London', 51.50266946081072, -0.11222662087529899, '08751314', 'https://www.waverleyosteopathicpract.co.uk', NULL, '{Osteo}', 2460000, 27, 1, 54, 'platform_import', NULL, '2025-04-28', NULL, '2026-06-10 18:01:41.092527+00', '2026-06-10 18:01:41.092527+00'),
	('76b9b64b-7d65-49e7-9887-090347221e94', 'Oakfield Rehab Centre', NULL, '179 High Street', NULL, 'London', 'SE22 2TQ', 'London', 51.47647374426946, -0.10411595879122615, '07543139', 'https://www.oakfieldrehabcentre.co.uk', NULL, '{Other}', 540000, 6, 1, 36, 'platform_import', NULL, '2025-12-28', NULL, '2026-06-10 18:01:41.096327+00', '2026-06-10 18:01:41.096327+00'),
	('38dd6c2c-0f48-4f03-b0ab-eb2d3650a0f7', 'Silverdale Osteopathy', NULL, '69 Station Road', NULL, 'Newcastle', 'NE1 8PR', 'North East', 54.94487952822819, -1.6296110021322967, NULL, 'https://www.silverdaleosteopathy.co.uk', NULL, '{Osteo}', 1520000, 17, 1, 77, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.100169+00', '2026-06-10 18:01:41.100169+00'),
	('74f1dc58-8366-4eab-997d-55054703a710', 'Vital Rehab Centre', NULL, '165 Station Road', NULL, 'Swansea', 'SA1 5JL', 'Wales', 51.646348219010974, -3.9538337203674017, '09900010', 'https://www.vitalrehabcentre.co.uk', NULL, '{Other}', 1170000, 13, 1, 56, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.102284+00', '2026-06-10 18:01:41.102284+00'),
	('1510db1c-fe21-4252-873f-5eafc953be64', 'Trinity Health Clinic', NULL, '119 Mill Lane', NULL, 'Cambridge', 'CB1 1JL', 'East of England', 52.20394375162199, 0.10534886276349426, '09480691', 'https://www.trinityhealthclinic.co.uk', NULL, '{Other}', 2430000, 27, 1, 59, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.10841+00', '2026-06-10 18:01:41.10841+00'),
	('a3354a0d-0c4f-47b3-9a81-f5d6d2f28a8d', 'Kingsway Sports Physio', NULL, '54 Church Lane', NULL, 'Durham', 'DH1 5BB', 'North East', 54.78629315918312, -1.6099726710654796, '11591823', 'https://www.kingswaysportsphysio.co.uk', NULL, '{Physio,Other}', 180000, 2, 1, 81, 'platform_import', NULL, '2025-08-28', NULL, '2026-06-10 18:01:41.111395+00', '2026-06-10 18:01:41.111395+00'),
	('1bd94efe-a254-43a2-8743-c0b336e64fa1', 'Redwood Chiropractic Clinic', NULL, '18 Market Square', NULL, 'Liverpool', 'L1 4PR', 'North West', 53.391184700801965, -2.949889719951898, '12074927', 'https://www.redwoodchiropracticclini.co.uk', NULL, '{Chiro,Podiatry}', 220000, 2, 1, 86, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.113848+00', '2026-06-10 18:01:41.113848+00'),
	('72a8bc5d-cd17-4b21-86a1-2f4a1b716f2f', 'Redwood Rehab Centre', NULL, '141 Market Square', NULL, 'Glasgow', 'G1 9JL', 'Scotland', 55.827193490490316, -4.231045151036232, NULL, 'https://www.redwoodrehabcentre.co.uk', NULL, '{Other}', 300000, 3, 1, 75, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.118892+00', '2026-06-10 18:01:41.118892+00'),
	('d2889409-cacc-4304-b746-ac5e7b181786', 'Lakeside Sports Physio', NULL, '74 Victoria Road', NULL, 'London', 'N1 7TQ', 'London', 51.5312591759488, -0.09864356592297555, '08740223', 'https://www.lakesidesportsphysio.co.uk', NULL, '{Physio}', 1720000, 19, 1, 59, 'platform_import', NULL, '2025-06-28', NULL, '2026-06-10 18:01:41.122244+00', '2026-06-10 18:01:41.122244+00'),
	('a6655bcf-6fff-4c7f-970d-f42014170075', 'Redwood Osteopathic Practice', NULL, '155 Victoria Road', NULL, 'Preston', 'PR1 3EH', 'North West', 53.79155730767175, -2.6764394329302013, '08963523', 'https://www.redwoodosteopathicpracti.co.uk', NULL, '{Osteo,Podiatry}', 230000, 3, 1, 87, 'platform_import', NULL, '2025-10-28', NULL, '2026-06-10 18:01:41.124834+00', '2026-06-10 18:01:41.124834+00'),
	('bb9b255c-2365-450d-9336-b4378d298a6f', 'Ironbridge Physio Clinic', NULL, '119 Mill Lane', NULL, 'Derby', 'DE1 8BB', 'East Midlands', 52.93005729923025, -1.4642857338488102, '06212253', 'https://www.ironbridgephysioclinic.co.uk', NULL, '{Physio}', 2480000, 28, 1, 75, 'platform_import', NULL, '2025-04-28', NULL, '2026-06-10 18:01:41.128081+00', '2026-06-10 18:01:41.128081+00'),
	('4e0ce46d-aff5-4a5d-b5d7-143be422c8ba', 'Meadow Health Clinic', NULL, '2 Victoria Road', NULL, 'Cardiff', 'CF10 1AA', 'Wales', 51.48980904759839, -3.196092763524503, '11634999', 'https://www.meadowhealthclinic.co.uk', NULL, '{Other}', 1010000, 11, 1, 53, 'platform_import', NULL, '2025-10-28', NULL, '2026-06-10 18:01:41.133697+00', '2026-06-10 18:01:41.133697+00'),
	('a6f85349-6098-453b-876f-d3f3a43bb7da', 'Beacon MSK Clinic', NULL, '117 Victoria Road', NULL, 'Coventry', 'CV1 4DX', 'West Midlands', 52.40686138417571, -1.540175947509706, '12577890', 'https://www.beaconmskclinic.co.uk', NULL, '{Physio}', 300000, 3, 1, 40, 'platform_import', NULL, '2025-06-28', NULL, '2026-06-10 18:01:41.13738+00', '2026-06-10 18:01:41.13738+00'),
	('1dcc7fff-1c5f-4103-83a8-2fc1c31be5ba', 'Lakeside Chiropractic Clinic', NULL, '18 Mill Lane', NULL, 'Ipswich', 'IP1 2JL', 'East of England', 52.03402329789475, 1.1165156278200448, '10980087', 'https://www.lakesidechiropracticclin.co.uk', NULL, '{Chiro}', 690000, 8, 1, 33, 'platform_import', NULL, '2025-03-28', NULL, '2026-06-10 18:01:41.141526+00', '2026-06-10 18:01:41.141526+00'),
	('e28ad9d9-b042-4f6d-b37a-127e7f788e12', 'Hawthorn Physiotherapy', NULL, '5 High Street', NULL, 'Guildford', 'GU1 1PR', 'South East', 51.24251517975703, -0.5432040685787797, '08709407', 'https://www.hawthornphysiotherapy.co.uk', NULL, '{Physio,Other}', 2240000, 25, 1, 41, 'platform_import', NULL, '2025-10-28', NULL, '2026-06-10 18:01:41.147155+00', '2026-06-10 18:01:41.147155+00'),
	('bc1531fb-4e72-414e-bd9c-0ea104782853', 'Juniper Health Clinic', NULL, '168 Mill Lane', NULL, 'Dundee', 'DD1 8DX', 'Scotland', 56.45992025252432, -2.950433161985129, '07120316', 'https://www.juniperhealthclinic.co.uk', NULL, '{Other}', 1700000, 19, 1, 59, 'platform_import', NULL, '2025-01-28', NULL, '2026-06-10 18:01:41.149787+00', '2026-06-10 18:01:41.149787+00'),
	('bfbc7ce8-0ca0-4254-9327-f442fdfa9598', 'Northgate Chiropractic Clinic', NULL, '181 Market Square', NULL, 'Leicester', 'LE1 5BB', 'East Midlands', 52.63878697266802, -1.1155527528747915, '09853031', 'https://www.northgatechiropracticcli.co.uk', NULL, '{Chiro}', 1910000, 21, 1, 35, 'platform_import', NULL, '2025-11-28', NULL, '2026-06-10 18:01:41.153296+00', '2026-06-10 18:01:41.153296+00'),
	('acbbe2c9-879a-4025-ba8c-eff1a552a37b', 'Meadow Podiatry', NULL, '159 Station Road', NULL, 'Norwich', 'NR2 1JL', 'East of England', 52.6364838629216, 1.3172229717485606, '10746242', 'https://www.meadowpodiatry.co.uk', NULL, '{Podiatry,Physio}', 990000, 11, 1, 79, 'platform_import', NULL, '2025-09-28', NULL, '2026-06-10 18:01:41.156703+00', '2026-06-10 18:01:41.156703+00'),
	('033905d8-b9a0-4aaa-a2ac-3fa7dca9b0ba', 'Waverley Chiropractic', NULL, '62 High Street', NULL, 'York', 'YO1 3AA', 'Yorkshire', 53.9886185107939, -1.0934133866243065, '11468269', 'https://www.waverleychiropractic.co.uk', NULL, '{Chiro}', 290000, 3, 1, 44, 'platform_import', NULL, '2025-01-28', NULL, '2026-06-10 18:01:41.160138+00', '2026-06-10 18:01:41.160138+00'),
	('ab7bbf74-7ef3-4a2f-af5e-e0b49d85bc5b', 'Kingsway Foot & Ankle Clinic', NULL, '103 Station Road', NULL, 'Reading', 'RG1 2PR', 'South East', 51.45533801518381, -0.9441112051717937, '10711041', 'https://www.kingswayfootankleclinic.co.uk', NULL, '{Podiatry}', 2480000, 28, 1, 63, 'platform_import', NULL, '2025-06-28', NULL, '2026-06-10 18:01:41.163306+00', '2026-06-10 18:01:41.163306+00'),
	('d980989d-9638-415a-a7ba-4a3b3817773a', 'Lakeside Rehab Centre', NULL, '173 Victoria Road', NULL, 'Sheffield', 'S1 2TQ', 'Yorkshire', 53.37073878426105, -1.4719217563048004, '11380253', 'https://www.lakesiderehabcentre.co.uk', NULL, '{Other}', 1240000, 14, 1, 48, 'platform_import', NULL, '2025-05-28', NULL, '2026-06-10 18:01:41.167489+00', '2026-06-10 18:01:41.167489+00'),
	('af3ce9d4-fc40-4b24-b3be-09efa6f4a58a', 'Quayside Osteopathy', NULL, '185 High Street', NULL, 'London', 'N1 2PR', 'London', 51.517826443314554, -0.12572208655998113, '06585620', 'https://www.quaysideosteopathy.co.uk', NULL, '{Osteo}', 1370000, 15, 1, 90, 'platform_import', NULL, '2025-11-28', NULL, '2026-06-10 18:01:41.172096+00', '2026-06-10 18:01:41.172096+00'),
	('6d9658f7-8213-4a59-abb6-dc342a86ba8a', 'Meadow Physiotherapy', NULL, '37 Station Road', NULL, 'Norwich', 'NR2 6PR', 'East of England', 52.62944947110489, 1.2556072160974145, '09189231', 'https://www.meadowphysiotherapy.co.uk', NULL, '{Physio}', 1230000, 14, 1, 80, 'platform_import', NULL, '2025-06-28', NULL, '2026-06-10 18:01:41.174533+00', '2026-06-10 18:01:41.174533+00'),
	('b2fe9f11-9570-4fe1-8465-1f17e2b3e2b4', 'Anchor Rehab Centre', NULL, '91 High Street', NULL, 'Dundee', 'DD1 8DX', 'Scotland', 56.421476858221, -2.941525445505977, '06276780', 'https://www.anchorrehabcentre.co.uk', NULL, '{Other}', 860000, 10, 1, 48, 'platform_import', NULL, NULL, NULL, '2026-06-10 18:01:41.176651+00', '2026-06-10 18:01:41.176651+00'),
	('845d9508-6eeb-4181-9e7b-5b41a26079f5', 'Vital Physiotherapy', NULL, '1 Market Square', NULL, 'Norwich', 'NR2 6JL', 'East of England', 52.59746471798048, 1.2964796927571296, '11750563', 'https://www.vitalphysiotherapy.co.uk', NULL, '{Physio}', 1550000, 17, 1, 55, 'platform_import', NULL, '2025-09-28', NULL, '2026-06-10 18:01:41.179898+00', '2026-06-10 18:01:41.179898+00'),
	('6b2f5f18-75e1-4be2-9762-c8b192a2bddb', 'Redwood Physiotherapy', NULL, '193 Station Road', NULL, 'Glasgow', 'G1 8TQ', 'Scotland', 55.84465422084555, -4.2117371801473205, '11181307', 'https://www.redwoodphysiotherapy.co.uk', NULL, '{Physio}', 290000, 3, 1, 32, 'platform_import', NULL, '2025-07-28', NULL, '2026-06-10 18:01:41.184164+00', '2026-06-10 18:01:41.184164+00');


--
-- Data for Name: ch_signals; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.ch_signals VALUES
	('468f1d03-e459-4a0c-820c-1f60c1cc325a', 'c17d2dba-ba1e-4b82-8670-63e0c888e1e8', 'accounts_filed', '{"filed_on": "2026-06-04", "made_up_to": "2025-12-31"}', '2026-06-04', false, '2026-06-10 18:01:41.832201+00', '2026-06-10 18:01:41.832201+00'),
	('c52d38db-1758-467a-84f0-5830cd719b2b', 'f89a374d-bb7d-4944-8554-9e8e92d9886e', 'director_change', '{"change": "Appointment of NEIL ROSS as director", "filed_on": "2026-05-30"}', '2026-05-30', false, '2026-06-10 18:01:41.832201+00', '2026-06-10 18:01:41.832201+00');


--
-- Data for Name: checklist_templates; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.checklist_templates VALUES
	('f2ab54bb-9547-4299-8184-dfa2afbe1df0', 'Due Diligence Pack', 'due_diligence', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00');


--
-- Data for Name: checklist_template_items; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.checklist_template_items VALUES
	('787af8bc-46ee-47fc-bafa-00e69732f318', 'f2ab54bb-9547-4299-8184-dfa2afbe1df0', 'Financial DD (QoE)', 1, 'kinetico', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00'),
	('f11e9142-3f68-4960-ba90-f4e63c40c22f', 'f2ab54bb-9547-4299-8184-dfa2afbe1df0', 'Legal DD', 2, 'buyer_solicitors', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00'),
	('1d07eea2-2a63-4d29-937d-a3dcf1fd2a3a', 'f2ab54bb-9547-4299-8184-dfa2afbe1df0', 'Property & leases review', 3, 'buyer_solicitors', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00'),
	('1de1bda2-ffbf-448b-88aa-b8980b9646bf', 'f2ab54bb-9547-4299-8184-dfa2afbe1df0', 'Clinical/regulatory (CQC, HTM 01-05, IRMER)', 4, 'kinetico', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00'),
	('3364f6ca-0bcb-4eec-809a-d05b96c05eb8', 'f2ab54bb-9547-4299-8184-dfa2afbe1df0', 'Employment & contractors', 5, 'sellers', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00'),
	('80890ee7-a4e2-4dca-8a9d-769415980dc5', 'f2ab54bb-9547-4299-8184-dfa2afbe1df0', 'IT & data', 6, 'kinetico', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00'),
	('19372305-3491-4b9f-ae82-ec777d3b6415', 'f2ab54bb-9547-4299-8184-dfa2afbe1df0', 'Insurance', 7, 'sellers', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00');


--
-- Data for Name: clinic_aliases; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.clinic_aliases VALUES
	('b1cb4a1f-f51c-4cf4-9ca1-5cc22c413376', '547de6b4-2f2d-4eb0-82fc-8e47a71038cf', 'Riverside Physio — Richmond', '2026-06-10 18:01:40.855209+00', '2026-06-10 18:01:40.855209+00'),
	('3feabbed-958a-4739-bc52-efff940a6ff9', '547de6b4-2f2d-4eb0-82fc-8e47a71038cf', 'Riverside Physio', '2026-06-10 18:01:40.859824+00', '2026-06-10 18:01:40.859824+00'),
	('74e5bde0-b211-4d85-a92e-d76bb59ed3d1', '482b3ccd-ecc9-4c42-b416-3c7d219d8010', 'Riverside Physio — Kingston', '2026-06-10 18:01:40.863437+00', '2026-06-10 18:01:40.863437+00'),
	('4140b198-1060-4826-aa9c-c5a7195e2f47', '482b3ccd-ecc9-4c42-b416-3c7d219d8010', 'Riverside Physio', '2026-06-10 18:01:40.865133+00', '2026-06-10 18:01:40.865133+00'),
	('bf16bf13-d1f9-46ac-9a00-c40974c293a3', 'f028b708-3931-481d-a5e7-59689d71ead1', 'Riverside Physio — Putney', '2026-06-10 18:01:40.868733+00', '2026-06-10 18:01:40.868733+00'),
	('82607510-044a-45f2-b59c-cc2f300c2e28', 'f028b708-3931-481d-a5e7-59689d71ead1', 'Riverside Physio', '2026-06-10 18:01:40.870253+00', '2026-06-10 18:01:40.870253+00'),
	('32d00621-b7cb-438f-a30f-37186546a069', 'c17d2dba-ba1e-4b82-8670-63e0c888e1e8', 'Harborne Spine & Sport', '2026-06-10 18:01:40.873834+00', '2026-06-10 18:01:40.873834+00'),
	('6bf28f25-81d3-4792-a5ae-f7b0980bb640', 'f89a374d-bb7d-4944-8554-9e8e92d9886e', 'Caledonia Physio Partners', '2026-06-10 18:01:40.878706+00', '2026-06-10 18:01:40.878706+00'),
	('dd60baed-f1ee-4cff-9384-71afc674f8ee', 'f89a374d-bb7d-4944-8554-9e8e92d9886e', 'Caledonia Physio', '2026-06-10 18:01:40.880228+00', '2026-06-10 18:01:40.880228+00'),
	('21105721-a962-4cab-bdb5-99b25d2783c7', '13131a80-0527-472f-81c4-fcf129de7b28', 'Albion MSK Clinic', '2026-06-10 18:01:40.883382+00', '2026-06-10 18:01:40.883382+00'),
	('32505658-f27d-4911-9bb4-6247c77bc971', '13131a80-0527-472f-81c4-fcf129de7b28', 'Albion MSK', '2026-06-10 18:01:40.884836+00', '2026-06-10 18:01:40.884836+00'),
	('4372ea30-436a-4447-8a8e-43b208607469', '9ca6913c-efa9-4b1c-af56-8be984160382', 'Westbourne Osteopathy', '2026-06-10 18:01:40.888962+00', '2026-06-10 18:01:40.888962+00'),
	('969e9fd5-7456-48d3-8fd8-6b0725de79e3', '74155a6e-57d0-49a8-8997-39d34c7c8dc5', 'The Pennine Physio Co.', '2026-06-10 18:01:40.895173+00', '2026-06-10 18:01:40.895173+00'),
	('182c7c5c-4829-483e-ac6d-d1635ff77a13', '8ff9c0ad-0f6c-4d26-871d-df56c041ffd5', 'Cathedral Physiotherapy', '2026-06-10 18:01:40.897632+00', '2026-06-10 18:01:40.897632+00'),
	('ffb54c6f-3a4e-4edd-ba8b-7f29bc90dce0', '7060c253-7c0f-4118-9a90-cd65eb1514d7', 'Granite City Physio', '2026-06-10 18:01:40.900559+00', '2026-06-10 18:01:40.900559+00'),
	('9fbfd4b6-d974-4ece-8a4e-957073dc69bb', '2ab4c7c8-83f7-46ea-b141-67191d84f5c3', 'Severn Sports Therapy', '2026-06-10 18:01:40.903994+00', '2026-06-10 18:01:40.903994+00'),
	('be385a08-8c64-4c14-b04e-5ae84934255e', '676b8459-cbe9-4757-9c98-2a87f6bdb812', 'Maple House Chiropractic', '2026-06-10 18:01:40.908417+00', '2026-06-10 18:01:40.908417+00'),
	('c6b46ff6-713f-4ddd-8f7d-483ac2c8b803', '66f8a271-45f3-45aa-9791-9ae97d1ca766', 'Oakfield Chiropractic Clinic', '2026-06-10 18:01:40.912504+00', '2026-06-10 18:01:40.912504+00'),
	('701d38c8-6774-4ed2-afeb-6f376ca6fdc2', '66f8a271-45f3-45aa-9791-9ae97d1ca766', 'Oakfield Chiropractic', '2026-06-10 18:01:40.913717+00', '2026-06-10 18:01:40.913717+00'),
	('04948dee-701a-4fe7-bace-373a53c1df3c', '9f0739d3-5a83-4575-b718-434f280c8bb5', 'Stonebridge Physio Clinic', '2026-06-10 18:01:40.916605+00', '2026-06-10 18:01:40.916605+00'),
	('2cd26a37-b986-420e-bf8e-e6063ac00d6f', '9f0739d3-5a83-4575-b718-434f280c8bb5', 'Stonebridge Physio', '2026-06-10 18:01:40.923989+00', '2026-06-10 18:01:40.923989+00'),
	('b3c1ca11-3459-4dde-b2fc-01c8ff9d048d', '4e7d14ca-3c89-439d-8100-2f6471e69a08', 'Vital Chiropractic Clinic', '2026-06-10 18:01:40.927124+00', '2026-06-10 18:01:40.927124+00'),
	('059691ed-f2b3-4348-aca3-86404c89deec', '4e7d14ca-3c89-439d-8100-2f6471e69a08', 'Vital Chiropractic', '2026-06-10 18:01:40.928315+00', '2026-06-10 18:01:40.928315+00'),
	('58f6f9a1-dac1-41ff-8fdb-7bde53b8ce00', 'c0b4b841-77da-4592-a489-e756d7a74e4a', 'Fairview Osteopathic Practice', '2026-06-10 18:01:40.9326+00', '2026-06-10 18:01:40.9326+00'),
	('807d8b58-32bc-4aea-a693-d4f09820e4e8', 'c0b4b841-77da-4592-a489-e756d7a74e4a', 'Fairview Osteopathic', '2026-06-10 18:01:40.933956+00', '2026-06-10 18:01:40.933956+00'),
	('753024ee-636c-444c-84ae-0a1d2c06e61c', 'cc5b4c38-5744-4a6e-9f61-4d674181de69', 'Anchor Foot & Ankle Clinic', '2026-06-10 18:01:40.936637+00', '2026-06-10 18:01:40.936637+00'),
	('33ba5eca-4e13-4d58-8253-bf841d3ec474', 'cc5b4c38-5744-4a6e-9f61-4d674181de69', 'Anchor Foot & Ankle', '2026-06-10 18:01:40.93765+00', '2026-06-10 18:01:40.93765+00'),
	('8a30397b-13e3-4db7-b53d-16c06f2c2677', 'ad5d678a-7968-4e56-88a0-b2afac88f266', 'Summit Chiropractic Clinic', '2026-06-10 18:01:40.939882+00', '2026-06-10 18:01:40.939882+00'),
	('c43002f1-9d78-416f-9901-f76346728d7f', 'ad5d678a-7968-4e56-88a0-b2afac88f266', 'Summit Chiropractic', '2026-06-10 18:01:40.940815+00', '2026-06-10 18:01:40.940815+00'),
	('ceaa0941-df92-43d2-bf7d-5dc249f0260d', '21125523-2ae9-451a-a2c4-4f1222dab67e', 'Ironbridge Foot & Ankle Clinic', '2026-06-10 18:01:40.944713+00', '2026-06-10 18:01:40.944713+00'),
	('c8c50953-f4cf-4377-8e59-cf067cd4ae1c', '21125523-2ae9-451a-a2c4-4f1222dab67e', 'Ironbridge Foot & Ankle', '2026-06-10 18:01:40.94578+00', '2026-06-10 18:01:40.94578+00'),
	('477c7799-1a2b-4418-9961-623df7b1d488', '41ccf277-a5e0-4d59-bf34-7a645c7cc8a3', 'Kingsway Chiropractic Clinic', '2026-06-10 18:01:40.947744+00', '2026-06-10 18:01:40.947744+00'),
	('6ba848a6-7982-4ed0-8656-e90c0d75bbfc', '41ccf277-a5e0-4d59-bf34-7a645c7cc8a3', 'Kingsway Chiropractic', '2026-06-10 18:01:40.948695+00', '2026-06-10 18:01:40.948695+00'),
	('6d015621-46e8-4611-82ef-8c867d61670b', 'eef6c4ea-3bf5-40f9-8fe0-d6ea22b5515f', 'Foxglove Physiotherapy', '2026-06-10 18:01:40.951152+00', '2026-06-10 18:01:40.951152+00'),
	('ca3d8fc6-a601-4752-b5ed-2d352e19b1cf', '007ac3f9-7c3f-4791-be07-9d6b6153caee', 'Summit Osteopathic Practice', '2026-06-10 18:01:40.953596+00', '2026-06-10 18:01:40.953596+00'),
	('e2dc41f4-060c-41f1-9609-4a0927de1a35', '007ac3f9-7c3f-4791-be07-9d6b6153caee', 'Summit Osteopathic', '2026-06-10 18:01:40.955787+00', '2026-06-10 18:01:40.955787+00'),
	('ee5888f9-7dbd-4cd3-80a0-d2f47e3fdc9f', '32c54111-7ab8-43a4-8037-8fe8dd3a17d0', 'Quayside Foot & Ankle Clinic', '2026-06-10 18:01:40.957973+00', '2026-06-10 18:01:40.957973+00'),
	('b6cadb76-7253-43d5-bf52-844801fb6157', '32c54111-7ab8-43a4-8037-8fe8dd3a17d0', 'Quayside Foot & Ankle', '2026-06-10 18:01:40.959138+00', '2026-06-10 18:01:40.959138+00'),
	('1e225834-8aaf-4b8b-8f80-efd03f16502c', '0240efe9-ec87-4037-b00f-9b4ede3fa4b0', 'Clearwater Podiatry', '2026-06-10 18:01:40.962401+00', '2026-06-10 18:01:40.962401+00'),
	('c799ddc0-6ddd-4789-a90b-1fe5f2e866c6', 'be05f157-9b16-4c5e-b0f2-b822cb3d5b60', 'Vital Health Clinic', '2026-06-10 18:01:40.964981+00', '2026-06-10 18:01:40.964981+00'),
	('593aca65-c5a5-48e2-93a4-d53012560c8b', 'be05f157-9b16-4c5e-b0f2-b822cb3d5b60', 'Vital Health', '2026-06-10 18:01:40.966188+00', '2026-06-10 18:01:40.966188+00'),
	('b9990a31-6687-4d4f-9219-89a792ef4c27', '93c2c556-44d6-41ba-b57f-1b5e0ba7d454', 'Motion Chiropractic', '2026-06-10 18:01:40.970577+00', '2026-06-10 18:01:40.970577+00'),
	('9823f415-d3c5-4dec-912f-25d10def845d', '86cf1ec6-c891-468c-873b-c2325d36d9ac', 'Waverley Physio Clinic', '2026-06-10 18:01:40.973366+00', '2026-06-10 18:01:40.973366+00'),
	('d25ab3e2-4b58-4aae-924f-7fa459c3b51e', '86cf1ec6-c891-468c-873b-c2325d36d9ac', 'Waverley Physio', '2026-06-10 18:01:40.974731+00', '2026-06-10 18:01:40.974731+00'),
	('e857394c-c516-494b-a2a9-0a6859545205', '43451731-48f0-4fc6-9e98-22f9394d7098', 'Hawthorn MSK Clinic', '2026-06-10 18:01:40.977704+00', '2026-06-10 18:01:40.977704+00'),
	('ea28debc-ae82-45ad-a014-5d0b7bef02e5', '43451731-48f0-4fc6-9e98-22f9394d7098', 'Hawthorn MSK', '2026-06-10 18:01:40.979162+00', '2026-06-10 18:01:40.979162+00'),
	('0b236380-4676-434a-9318-f1db0fb74724', 'f5856934-85cb-4f3e-8a28-cd64ab6c80d2', 'Hawthorn Physio Clinic', '2026-06-10 18:01:40.982478+00', '2026-06-10 18:01:40.982478+00'),
	('bd321131-3820-46c4-ac91-226a3c2f3ea4', 'f5856934-85cb-4f3e-8a28-cd64ab6c80d2', 'Hawthorn Physio', '2026-06-10 18:01:40.986291+00', '2026-06-10 18:01:40.986291+00'),
	('ac68e1e6-aaac-4040-b114-f1c73266b79f', '07e8c8d5-d980-4d48-98c5-1024756e626f', 'Northgate Osteopathic Practice', '2026-06-10 18:01:40.989268+00', '2026-06-10 18:01:40.989268+00'),
	('b614d337-8d04-4f46-bcac-9d93af829f19', '07e8c8d5-d980-4d48-98c5-1024756e626f', 'Northgate Osteopathic', '2026-06-10 18:01:40.991108+00', '2026-06-10 18:01:40.991108+00');
INSERT INTO public.clinic_aliases VALUES
	('dcc5f83f-3ab9-43df-8c56-c1a7e084c574', '057f7e81-be41-497e-ac99-204310fb4ed4', 'Fairview Chiropractic Clinic', '2026-06-10 18:01:40.994274+00', '2026-06-10 18:01:40.994274+00'),
	('4a34d18b-d92e-46c2-92a9-e51b145f3491', '057f7e81-be41-497e-ac99-204310fb4ed4', 'Fairview Chiropractic', '2026-06-10 18:01:40.995533+00', '2026-06-10 18:01:40.995533+00'),
	('c28b12fe-2296-4a78-97f5-0f8399697619', '20af211a-9965-4d21-b7c3-d733efa4090f', 'Silverdale Rehab Centre', '2026-06-10 18:01:40.99837+00', '2026-06-10 18:01:40.99837+00'),
	('5db9ea9f-bfe5-4bd5-af5e-af7825f43ee1', '20af211a-9965-4d21-b7c3-d733efa4090f', 'Silverdale Rehab', '2026-06-10 18:01:41.001012+00', '2026-06-10 18:01:41.001012+00'),
	('aaaca69c-9064-4bfa-acb9-9c0d57463c90', '5f411982-de5f-4b88-a7d6-32c89febae8f', 'Clearwater Chiropractic', '2026-06-10 18:01:41.007079+00', '2026-06-10 18:01:41.007079+00'),
	('3faa6505-62ef-40fb-a5e2-f1fc49fa278c', '3dbaaf83-2b65-4cd4-9441-2b95c322c89f', 'Birchwood MSK Clinic', '2026-06-10 18:01:41.009581+00', '2026-06-10 18:01:41.009581+00'),
	('63ea67ad-f393-4a9b-bded-91b4f63fc489', '3dbaaf83-2b65-4cd4-9441-2b95c322c89f', 'Birchwood MSK', '2026-06-10 18:01:41.010735+00', '2026-06-10 18:01:41.010735+00'),
	('cc9dd499-b557-4b2e-9eda-f5ae6cca93a9', '217e7b9f-e852-468e-84b4-2edb3944a11d', 'Kingsway Osteopathy', '2026-06-10 18:01:41.013017+00', '2026-06-10 18:01:41.013017+00'),
	('2c5bd7ac-72e5-40dd-998f-a3ae1fbb6416', '9786b323-88db-4aac-bf71-8e3c80f6aac8', 'Summit Rehab Centre', '2026-06-10 18:01:41.01674+00', '2026-06-10 18:01:41.01674+00'),
	('4ac3c4e7-38e0-4936-bb01-6b234222c61a', '9786b323-88db-4aac-bf71-8e3c80f6aac8', 'Summit Rehab', '2026-06-10 18:01:41.020189+00', '2026-06-10 18:01:41.020189+00'),
	('e92b0a2e-abe5-46f9-b65b-6c92f9340ea2', 'd8a7125f-0fc2-4397-9fff-1e02250793e0', 'Ironbridge Rehab Centre', '2026-06-10 18:01:41.023907+00', '2026-06-10 18:01:41.023907+00'),
	('9b51d911-4e8e-45c1-96eb-695672931f17', 'd8a7125f-0fc2-4397-9fff-1e02250793e0', 'Ironbridge Rehab', '2026-06-10 18:01:41.025196+00', '2026-06-10 18:01:41.025196+00'),
	('3e3fc1d2-9fc9-4fd1-a14c-e5f80c2edc42', '0795b7e8-6c40-4139-824f-42412d75f645', 'Stonebridge Sports Physio', '2026-06-10 18:01:41.028617+00', '2026-06-10 18:01:41.028617+00'),
	('56b5b0c2-0405-4082-9304-b63d42fbe1a3', '0dd6dba5-52b9-405a-b5cd-6b7d67330030', 'Motion Sports Physio', '2026-06-10 18:01:41.031882+00', '2026-06-10 18:01:41.031882+00'),
	('dc4dae58-13c2-41f0-910a-d53ec7cd7ace', '642b64d8-278f-4ed2-b23e-1f118c7ab6c6', 'Greenway Sports Physio', '2026-06-10 18:01:41.037507+00', '2026-06-10 18:01:41.037507+00'),
	('273aa476-dd56-4f2b-b198-9e1045a8ffe0', 'b7ab84a6-22da-4a2f-a5b7-bfd75be6b82d', 'Foxglove Chiropractic', '2026-06-10 18:01:41.04077+00', '2026-06-10 18:01:41.04077+00'),
	('fbad1f7e-7bcf-445e-b8e3-c3f8a2cd1b94', 'a520b434-6e76-48c8-ad4a-808e287c289d', 'Birchwood Osteopathy', '2026-06-10 18:01:41.043948+00', '2026-06-10 18:01:41.043948+00'),
	('7b9e516a-dddc-4454-a9e8-ad5c6ce50f72', '5215d92b-8748-47b1-a893-b0a566ff4b0d', 'Greenway Podiatry', '2026-06-10 18:01:41.046152+00', '2026-06-10 18:01:41.046152+00'),
	('ec7bae86-e352-4837-a2ea-50691c6482ba', 'd76fd0c2-d7bc-42bd-9e7a-d17dbaeaf9f7', 'Oakfield Osteopathic Practice', '2026-06-10 18:01:41.049074+00', '2026-06-10 18:01:41.049074+00'),
	('96895a1d-ff9f-4fc7-87ca-9a9ff90f4469', 'd76fd0c2-d7bc-42bd-9e7a-d17dbaeaf9f7', 'Oakfield Osteopathic', '2026-06-10 18:01:41.05019+00', '2026-06-10 18:01:41.05019+00'),
	('5a3c3210-167a-4663-a7ce-53d6f95da9ac', 'a259409f-6c7e-43eb-9d7f-b5f675b3968f', 'Foxglove Physio Clinic', '2026-06-10 18:01:41.05257+00', '2026-06-10 18:01:41.05257+00'),
	('39d91188-c8db-41f5-978d-2ace6b64e03c', 'a259409f-6c7e-43eb-9d7f-b5f675b3968f', 'Foxglove Physio', '2026-06-10 18:01:41.053395+00', '2026-06-10 18:01:41.053395+00'),
	('4189b3ce-212a-44bb-bf7f-a581ae3204a7', '5ee099ae-707a-491c-bc5e-ac7a3438bb67', 'Foxglove Health Clinic', '2026-06-10 18:01:41.055835+00', '2026-06-10 18:01:41.055835+00'),
	('81c9a6de-bfd1-41ad-904f-53ea71b51b5c', '5ee099ae-707a-491c-bc5e-ac7a3438bb67', 'Foxglove Health', '2026-06-10 18:01:41.057333+00', '2026-06-10 18:01:41.057333+00'),
	('e766fedf-549d-4ec6-a1a0-ffc320f5f23f', '44f017c1-875f-46de-84de-275d200b17c6', 'Redwood MSK Clinic', '2026-06-10 18:01:41.059772+00', '2026-06-10 18:01:41.059772+00'),
	('9eb4502c-0304-4dff-96cf-8c44ab07226c', '44f017c1-875f-46de-84de-275d200b17c6', 'Redwood MSK', '2026-06-10 18:01:41.060904+00', '2026-06-10 18:01:41.060904+00'),
	('09e7a29d-b33c-456d-be1c-1eceffcafb0d', 'd457a649-c169-41cb-9cdd-6566922d481f', 'Trinity Podiatry', '2026-06-10 18:01:41.064277+00', '2026-06-10 18:01:41.064277+00'),
	('006fae5d-bb0a-4bca-8984-f5f253ff0a70', '02e8c30a-927e-4b5a-88b7-d90ca9ab83bd', 'Silverdale MSK Clinic', '2026-06-10 18:01:41.066605+00', '2026-06-10 18:01:41.066605+00'),
	('da9b2cf5-2547-49fd-9ecf-7b95f4214516', '02e8c30a-927e-4b5a-88b7-d90ca9ab83bd', 'Silverdale MSK', '2026-06-10 18:01:41.067691+00', '2026-06-10 18:01:41.067691+00'),
	('06366fb3-1089-48a8-bcd3-2406a3bf1e7e', '37fdc85d-44fb-419d-9eaa-c1bf648740bd', 'Northgate Rehab Centre', '2026-06-10 18:01:41.069951+00', '2026-06-10 18:01:41.069951+00'),
	('974cb2fc-75b3-4d9c-a3ff-14aa6e51a34b', '37fdc85d-44fb-419d-9eaa-c1bf648740bd', 'Northgate Rehab', '2026-06-10 18:01:41.070959+00', '2026-06-10 18:01:41.070959+00'),
	('29e5782e-69b0-463b-a9ef-b6ad5c8099f1', '4e583df0-6a47-4bb5-b6ac-37c95423d300', 'Apex Chiropractic Clinic', '2026-06-10 18:01:41.077192+00', '2026-06-10 18:01:41.077192+00'),
	('d4aa3ea2-9332-456c-9012-f97211ecc710', '4e583df0-6a47-4bb5-b6ac-37c95423d300', 'Apex Chiropractic', '2026-06-10 18:01:41.079341+00', '2026-06-10 18:01:41.079341+00'),
	('45fa1fdf-ec1e-4a05-b6fb-ddf565fcee47', '9a58f5a2-e8e5-4dc2-be71-4835639a3de7', 'Greenway Health Clinic', '2026-06-10 18:01:41.082542+00', '2026-06-10 18:01:41.082542+00'),
	('2def01f2-d751-4ee3-9454-e5d59bc80d0a', '9a58f5a2-e8e5-4dc2-be71-4835639a3de7', 'Greenway Health', '2026-06-10 18:01:41.083768+00', '2026-06-10 18:01:41.083768+00'),
	('e37b4176-07be-4436-87a6-06529a3dbf8a', '43b0bbeb-8edd-4a48-a223-4cd0927b222f', 'Beacon Health Clinic', '2026-06-10 18:01:41.085934+00', '2026-06-10 18:01:41.085934+00'),
	('2f86087e-b44f-43ca-a6f6-4df1e8eae3a6', '43b0bbeb-8edd-4a48-a223-4cd0927b222f', 'Beacon Health', '2026-06-10 18:01:41.087071+00', '2026-06-10 18:01:41.087071+00'),
	('f2dd219d-3eee-4e7f-8e5c-8fc69db61781', 'ae60f951-eb63-40f7-8157-aed7cf32b6de', 'Waverley Podiatry', '2026-06-10 18:01:41.089306+00', '2026-06-10 18:01:41.089306+00'),
	('627a88c3-da0d-4ef6-97c9-0c3479633cab', '454ef13a-4dee-42b5-a177-2c5ba9da2371', 'Waverley Osteopathic Practice', '2026-06-10 18:01:41.093786+00', '2026-06-10 18:01:41.093786+00'),
	('bf67492e-8d5c-4724-a5c8-c12ad058edfe', '454ef13a-4dee-42b5-a177-2c5ba9da2371', 'Waverley Osteopathic', '2026-06-10 18:01:41.094979+00', '2026-06-10 18:01:41.094979+00'),
	('a11f2bcd-69e5-4b1e-a514-f0af2c2c7a95', '76b9b64b-7d65-49e7-9887-090347221e94', 'Oakfield Rehab Centre', '2026-06-10 18:01:41.097961+00', '2026-06-10 18:01:41.097961+00'),
	('a6b2a830-2504-43fd-86ef-0dc1a1a17697', '76b9b64b-7d65-49e7-9887-090347221e94', 'Oakfield Rehab', '2026-06-10 18:01:41.09908+00', '2026-06-10 18:01:41.09908+00'),
	('bbda566f-2f00-4f19-89e3-d6683bd4b3bf', '38dd6c2c-0f48-4f03-b0ab-eb2d3650a0f7', 'Silverdale Osteopathy', '2026-06-10 18:01:41.101072+00', '2026-06-10 18:01:41.101072+00'),
	('36f8666a-3af5-4818-9d8d-8e9ea15adc5d', '74f1dc58-8366-4eab-997d-55054703a710', 'Vital Rehab Centre', '2026-06-10 18:01:41.105367+00', '2026-06-10 18:01:41.105367+00'),
	('8ba25cf0-694e-4609-aa85-d824a52c5ea0', '74f1dc58-8366-4eab-997d-55054703a710', 'Vital Rehab', '2026-06-10 18:01:41.107209+00', '2026-06-10 18:01:41.107209+00'),
	('e04bb7e3-b94a-48c1-9a39-9828822e3be5', '1510db1c-fe21-4252-873f-5eafc953be64', 'Trinity Health Clinic', '2026-06-10 18:01:41.109428+00', '2026-06-10 18:01:41.109428+00'),
	('d12b8517-b9c8-4736-87e9-1b5923625e6c', '1510db1c-fe21-4252-873f-5eafc953be64', 'Trinity Health', '2026-06-10 18:01:41.110256+00', '2026-06-10 18:01:41.110256+00'),
	('c2f628bc-813b-47bb-803f-e706332033b9', 'a3354a0d-0c4f-47b3-9a81-f5d6d2f28a8d', 'Kingsway Sports Physio', '2026-06-10 18:01:41.112692+00', '2026-06-10 18:01:41.112692+00'),
	('33da6f84-04cd-4f77-9074-e91c90470380', '1bd94efe-a254-43a2-8743-c0b336e64fa1', 'Redwood Chiropractic Clinic', '2026-06-10 18:01:41.11534+00', '2026-06-10 18:01:41.11534+00'),
	('59d2766f-2c43-4bcf-8733-b1e42e03a482', '1bd94efe-a254-43a2-8743-c0b336e64fa1', 'Redwood Chiropractic', '2026-06-10 18:01:41.116549+00', '2026-06-10 18:01:41.116549+00');
INSERT INTO public.clinic_aliases VALUES
	('f4c50371-5c50-4b26-ba55-61b45be59b8c', '72a8bc5d-cd17-4b21-86a1-2f4a1b716f2f', 'Redwood Rehab Centre', '2026-06-10 18:01:41.119977+00', '2026-06-10 18:01:41.119977+00'),
	('5be9530b-318c-463e-870c-69e63db363af', '72a8bc5d-cd17-4b21-86a1-2f4a1b716f2f', 'Redwood Rehab', '2026-06-10 18:01:41.12114+00', '2026-06-10 18:01:41.12114+00'),
	('0f8bfba5-72f8-42a0-a9f9-cdd0117788ae', 'd2889409-cacc-4304-b746-ac5e7b181786', 'Lakeside Sports Physio', '2026-06-10 18:01:41.123653+00', '2026-06-10 18:01:41.123653+00'),
	('f5374790-9b2c-4358-a6ae-29d078aef895', 'a6655bcf-6fff-4c7f-970d-f42014170075', 'Redwood Osteopathic Practice', '2026-06-10 18:01:41.125973+00', '2026-06-10 18:01:41.125973+00'),
	('813efe2f-2c5f-477e-b259-cded691fcc2c', 'a6655bcf-6fff-4c7f-970d-f42014170075', 'Redwood Osteopathic', '2026-06-10 18:01:41.127043+00', '2026-06-10 18:01:41.127043+00'),
	('13c474ac-c809-4516-a07a-bd928543f38a', 'bb9b255c-2365-450d-9336-b4378d298a6f', 'Ironbridge Physio Clinic', '2026-06-10 18:01:41.131611+00', '2026-06-10 18:01:41.131611+00'),
	('ac60110d-aa83-47a5-bdc3-94a332fb0291', 'bb9b255c-2365-450d-9336-b4378d298a6f', 'Ironbridge Physio', '2026-06-10 18:01:41.132617+00', '2026-06-10 18:01:41.132617+00'),
	('3513fe99-9c19-4931-b2bf-ce191363d918', '4e0ce46d-aff5-4a5d-b5d7-143be422c8ba', 'Meadow Health Clinic', '2026-06-10 18:01:41.134858+00', '2026-06-10 18:01:41.134858+00'),
	('6f55276f-5502-4b9b-9881-23cf32120cbf', '4e0ce46d-aff5-4a5d-b5d7-143be422c8ba', 'Meadow Health', '2026-06-10 18:01:41.135903+00', '2026-06-10 18:01:41.135903+00'),
	('494ee3ff-04f2-45da-b9cf-3db32d81fcda', 'a6f85349-6098-453b-876f-d3f3a43bb7da', 'Beacon MSK Clinic', '2026-06-10 18:01:41.139313+00', '2026-06-10 18:01:41.139313+00'),
	('6f07275c-f41c-4b97-b84c-73fc752691d2', 'a6f85349-6098-453b-876f-d3f3a43bb7da', 'Beacon MSK', '2026-06-10 18:01:41.140406+00', '2026-06-10 18:01:41.140406+00'),
	('0c7d2d82-a20e-41f9-85ee-58942f19f47a', '1dcc7fff-1c5f-4103-83a8-2fc1c31be5ba', 'Lakeside Chiropractic Clinic', '2026-06-10 18:01:41.142845+00', '2026-06-10 18:01:41.142845+00'),
	('7a302e7b-5c9a-4f66-859d-a6bea265a003', '1dcc7fff-1c5f-4103-83a8-2fc1c31be5ba', 'Lakeside Chiropractic', '2026-06-10 18:01:41.145976+00', '2026-06-10 18:01:41.145976+00'),
	('400ac7ba-c72c-4cb4-94a2-3a7333cb083e', 'e28ad9d9-b042-4f6d-b37a-127e7f788e12', 'Hawthorn Physiotherapy', '2026-06-10 18:01:41.148439+00', '2026-06-10 18:01:41.148439+00'),
	('3def3870-c16e-42a1-859e-9f20f90b6a9c', 'bc1531fb-4e72-414e-bd9c-0ea104782853', 'Juniper Health Clinic', '2026-06-10 18:01:41.150791+00', '2026-06-10 18:01:41.150791+00'),
	('f392de55-c233-4401-bcc2-c759445dd0b9', 'bc1531fb-4e72-414e-bd9c-0ea104782853', 'Juniper Health', '2026-06-10 18:01:41.15171+00', '2026-06-10 18:01:41.15171+00'),
	('b329a67e-f017-4bee-9bf0-2f76d812ecc7', 'bfbc7ce8-0ca0-4254-9327-f442fdfa9598', 'Northgate Chiropractic Clinic', '2026-06-10 18:01:41.154325+00', '2026-06-10 18:01:41.154325+00'),
	('8b81ed02-81f5-4aed-be27-0e8900d64857', 'bfbc7ce8-0ca0-4254-9327-f442fdfa9598', 'Northgate Chiropractic', '2026-06-10 18:01:41.155629+00', '2026-06-10 18:01:41.155629+00'),
	('1caa1d83-7f8d-47e0-8c35-727863b55227', 'acbbe2c9-879a-4025-ba8c-eff1a552a37b', 'Meadow Podiatry', '2026-06-10 18:01:41.158902+00', '2026-06-10 18:01:41.158902+00'),
	('59cb51c3-3ad7-4524-ac1b-cc892dac9cf3', '033905d8-b9a0-4aaa-a2ac-3fa7dca9b0ba', 'Waverley Chiropractic', '2026-06-10 18:01:41.161895+00', '2026-06-10 18:01:41.161895+00'),
	('a05755ed-3ee0-472b-bd3c-beffc6624d4d', 'ab7bbf74-7ef3-4a2f-af5e-e0b49d85bc5b', 'Kingsway Foot & Ankle Clinic', '2026-06-10 18:01:41.164484+00', '2026-06-10 18:01:41.164484+00'),
	('c3d5cb7a-434e-4a75-adcc-407bed84c402', 'ab7bbf74-7ef3-4a2f-af5e-e0b49d85bc5b', 'Kingsway Foot & Ankle', '2026-06-10 18:01:41.165824+00', '2026-06-10 18:01:41.165824+00'),
	('4e48cf04-072a-4d82-b6de-466522a65f82', 'd980989d-9638-415a-a7ba-4a3b3817773a', 'Lakeside Rehab Centre', '2026-06-10 18:01:41.168806+00', '2026-06-10 18:01:41.168806+00'),
	('eb7347e8-d3d6-4f1d-8a4b-5638bce3b9bd', 'd980989d-9638-415a-a7ba-4a3b3817773a', 'Lakeside Rehab', '2026-06-10 18:01:41.16983+00', '2026-06-10 18:01:41.16983+00'),
	('d8d2c5e4-4a0d-4ff1-a092-d11e137a5781', 'af3ce9d4-fc40-4b24-b3be-09efa6f4a58a', 'Quayside Osteopathy', '2026-06-10 18:01:41.173194+00', '2026-06-10 18:01:41.173194+00'),
	('ba018c56-ad7a-4236-9cee-8955615dbdf6', '6d9658f7-8213-4a59-abb6-dc342a86ba8a', 'Meadow Physiotherapy', '2026-06-10 18:01:41.175662+00', '2026-06-10 18:01:41.175662+00'),
	('34afaf70-6d71-4da1-a2b1-27b9c769a5c5', 'b2fe9f11-9570-4fe1-8465-1f17e2b3e2b4', 'Anchor Rehab Centre', '2026-06-10 18:01:41.177744+00', '2026-06-10 18:01:41.177744+00'),
	('6a43880c-1a34-4282-a48d-90ebd0bb70a3', 'b2fe9f11-9570-4fe1-8465-1f17e2b3e2b4', 'Anchor Rehab', '2026-06-10 18:01:41.178772+00', '2026-06-10 18:01:41.178772+00'),
	('eeea8940-bbe2-4661-935f-8f7f32444086', '845d9508-6eeb-4181-9e7b-5b41a26079f5', 'Vital Physiotherapy', '2026-06-10 18:01:41.181228+00', '2026-06-10 18:01:41.181228+00'),
	('cbb4e062-4c89-4b0f-b24b-e4c22ec03e26', '6b2f5f18-75e1-4be2-9762-c8b192a2bddb', 'Redwood Physiotherapy', '2026-06-10 18:01:41.185607+00', '2026-06-10 18:01:41.185607+00');


--
-- Data for Name: column_settings; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.column_settings VALUES
	('identified', 0.02, 1, '2026-06-10 18:01:40.689296+00', '2026-06-10 18:01:40.689296+00'),
	('silver', 0.05, 2, '2026-06-10 18:01:40.689296+00', '2026-06-10 18:01:40.689296+00'),
	('gold', 0.10, 3, '2026-06-10 18:01:40.689296+00', '2026-06-10 18:01:40.689296+00'),
	('platinum', 0.20, 4, '2026-06-10 18:01:40.689296+00', '2026-06-10 18:01:40.689296+00'),
	('active_discussions', 0.35, 5, '2026-06-10 18:01:40.689296+00', '2026-06-10 18:01:40.689296+00'),
	('due_diligence', 0.60, 6, '2026-06-10 18:01:40.689296+00', '2026-06-10 18:01:40.689296+00'),
	('hots', 0.80, 7, '2026-06-10 18:01:40.689296+00', '2026-06-10 18:01:40.689296+00'),
	('complete', 1.00, 8, '2026-06-10 18:01:40.689296+00', '2026-06-10 18:01:40.689296+00'),
	('reengage', 0.05, 9, '2026-06-10 18:01:40.689296+00', '2026-06-10 18:01:40.689296+00'),
	('dead', 0.00, 10, '2026-06-10 18:01:40.689296+00', '2026-06-10 18:01:40.689296+00');


--
-- Data for Name: deals; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.deals VALUES
	('6fcddeee-03dc-4aa9-9e55-045cf9afc762', '547de6b4-2f2d-4eb0-82fc-8e47a71038cf', 'Riverside Physio Group', 'hots', 'gold', DEFAULT, '2025-12-09', 'Met Sarah Whitfield at Therapy Expo (NEC) — intro via stand neighbour.', '54786622-76b3-4642-aeef-d73aaba847c8', 'Return SPA v3 markup to Hartley Law', '2026-06-13', '2026-04-30 15:00:00+00', NULL, NULL, '"{\"EBITDA (normalised)\":\"£405k\",\"Revenue split\":\"Richmond £720k / Kingston £540k / Putney £360k\",\"Sellers\":\"Sarah & Mark Whitfield (50/50)\",\"Adviser\":\"Tom Bryce, Bryce CF\",\"Seller solicitors\":\"Hartley Law (Priya Shah)\",\"Project name\":\"Project Thames\"}"', '2026-06-10 18:01:41.304898+00', '2026-06-10 18:01:41.342859+00', NULL),
	('18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', 'c17d2dba-ba1e-4b82-8670-63e0c888e1e8', 'Harborne Spine & Sport', 'due_diligence', 'gold', DEFAULT, '2026-01-11', 'Inbound enquiry via website after our Birmingham acquisition was announced.', '54786622-76b3-4642-aeef-d73aaba847c8', 'Review week-3 financial DD responses', '2026-06-12', NULL, NULL, NULL, '"{\"EBITDA (normalised)\":\"£210k\",\"Owner ask\":\"2 days/week clinical for 12 months\"}"', '2026-06-10 18:01:41.407816+00', '2026-06-10 18:01:41.419552+00', NULL),
	('a6ed8ae6-278c-42aa-a755-89609dd587af', 'f89a374d-bb7d-4944-8554-9e8e92d9886e', 'Caledonia Physio Partners', 'active_discussions', NULL, DEFAULT, '2026-03-12', 'Referred by our Edinburgh clinical director.', '19fca03c-771e-4ac8-ba7d-2108e7c73832', 'Send group equity rollover overview', '2026-06-08', NULL, NULL, NULL, '"{\"Structure\":\"Two minority partners at 10% each\",\"Lease\":\"Leith renewal due March\"}"', '2026-06-10 18:01:41.435723+00', '2026-06-10 18:01:41.441043+00', NULL),
	('4cd719b8-eddb-4486-8ce1-9d34a74729a4', '13131a80-0527-472f-81c4-fcf129de7b28', 'Albion MSK Clinic', 'active_discussions', 'silver', DEFAULT, '2026-03-02', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', 'Meet Dee — review Q3 management accounts', '2026-06-16', NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.446748+00', '2026-06-10 18:01:41.455226+00', NULL),
	('a45b01a2-cec5-4e1c-8306-e9d0a4b60077', '9ca6913c-efa9-4b1c-af56-8be984160382', 'Westbourne Osteopathy', 'platinum', 'platinum', DEFAULT, '2026-03-22', NULL, '19fca03c-771e-4ac8-ba7d-2108e7c73832', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.462816+00', '2026-06-10 18:01:41.467519+00', NULL),
	('027f5758-2aa8-4232-bb83-cbd52d40e30e', '74155a6e-57d0-49a8-8997-39d34c7c8dc5', 'The Pennine Physio Co.', 'gold', 'gold', DEFAULT, '2026-03-27', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.475879+00', '2026-06-10 18:01:41.479182+00', NULL),
	('67536aed-097d-4f18-9f85-5392db23ccca', '8ff9c0ad-0f6c-4d26-871d-df56c041ffd5', 'Cathedral Physiotherapy', 'complete', 'gold', DEFAULT, '2025-08-14', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, NULL, NULL, '"{\"Completed\":\"Kinetico''s third acquisition\",\"Integration\":\"Done — on group PMS since month 2\"}"', '2026-06-10 18:01:41.485188+00', '2026-06-10 18:01:41.498962+00', NULL),
	('1b6bc658-ec5d-4bde-bcd4-604db6721e8a', '7060c253-7c0f-4118-9a90-cd65eb1514d7', 'Granite City Physio', 'dead', NULL, DEFAULT, '2025-11-22', NULL, '19fca03c-771e-4ac8-ba7d-2108e7c73832', NULL, NULL, NULL, NULL, 'Vendor wanted 8× EBITDA — unbridgeable gap on price after two revised offers.', '"{}"', '2026-06-10 18:01:41.510088+00', '2026-06-10 18:01:41.51538+00', NULL),
	('1161e808-2817-4f47-8b14-d9c8863dcba1', '2ab4c7c8-83f7-46ea-b141-67191d84f5c3', 'Severn Sports Therapy', 'reengage', NULL, DEFAULT, '2025-12-12', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, '2026-06-20', NULL, '"{\"Paused because\":\"Gemma wanted to finish the clinic refit before diligence\"}"', '2026-06-10 18:01:41.52049+00', '2026-06-10 18:01:41.524164+00', NULL),
	('2cd37272-e23d-4934-9cff-432c8573f33f', '676b8459-cbe9-4757-9c98-2a87f6bdb812', 'Maple House Chiropractic', 'silver', 'silver', DEFAULT, '2026-04-11', NULL, '19fca03c-771e-4ac8-ba7d-2108e7c73832', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.533758+00', '2026-06-10 18:01:41.536567+00', NULL),
	('4231a51e-56d4-4957-937a-783ada5369fd', '66f8a271-45f3-45aa-9791-9ae97d1ca766', 'Oakfield Chiropractic Clinic', 'identified', NULL, DEFAULT, '2026-05-16', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.541283+00', '2026-06-10 18:01:41.541283+00', NULL),
	('1e59e645-ba91-4434-9b42-05b356a17b97', '9f0739d3-5a83-4575-b718-434f280c8bb5', 'Stonebridge Physio Clinic', 'identified', NULL, DEFAULT, '2026-05-23', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.550968+00', '2026-06-10 18:01:41.550968+00', NULL),
	('3b2d2fa1-9ea6-42a2-ad8a-374a7ded2e50', '4e7d14ca-3c89-439d-8100-2f6471e69a08', 'Vital Chiropractic Clinic', 'identified', NULL, DEFAULT, '2026-04-26', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.557087+00', '2026-06-10 18:01:41.557087+00', NULL),
	('e177b41b-d749-4cd0-8e69-25b953dac288', 'c0b4b841-77da-4592-a489-e756d7a74e4a', 'Fairview Osteopathic Practice', 'identified', NULL, DEFAULT, '2026-05-29', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.564711+00', '2026-06-10 18:01:41.564711+00', NULL),
	('97d20fa2-de94-4e10-bb18-1a18bd3b5a04', 'cc5b4c38-5744-4a6e-9f61-4d674181de69', 'Anchor Foot & Ankle Clinic', 'identified', NULL, DEFAULT, '2026-04-01', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.573571+00', '2026-06-10 18:01:41.573571+00', NULL),
	('d1e5a6c0-d634-4c64-a2d7-32bb0ef42834', 'ad5d678a-7968-4e56-88a0-b2afac88f266', 'Summit Chiropractic Clinic', 'identified', NULL, DEFAULT, '2026-06-01', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.580185+00', '2026-06-10 18:01:41.580185+00', NULL),
	('e51280ba-d3b2-46e6-b213-286cfbcd4079', '21125523-2ae9-451a-a2c4-4f1222dab67e', 'Ironbridge Foot & Ankle Clinic', 'silver', 'silver', DEFAULT, '2026-04-16', NULL, '19fca03c-771e-4ac8-ba7d-2108e7c73832', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.584607+00', '2026-06-10 18:01:41.589479+00', NULL),
	('c4655cb1-a961-4e53-b532-be7aa623c880', '41ccf277-a5e0-4d59-bf34-7a645c7cc8a3', 'Kingsway Chiropractic Clinic', 'silver', 'silver', DEFAULT, '2026-04-06', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.596737+00', '2026-06-10 18:01:41.599393+00', NULL),
	('b11d9e25-d742-48eb-8454-5e654f9eb885', 'eef6c4ea-3bf5-40f9-8fe0-d6ea22b5515f', 'Foxglove Physiotherapy', 'silver', 'silver', DEFAULT, '2026-05-06', NULL, '19fca03c-771e-4ac8-ba7d-2108e7c73832', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.605077+00', '2026-06-10 18:01:41.608357+00', NULL),
	('bacc0c31-58db-455f-b5d9-4593df0f9759', '007ac3f9-7c3f-4791-be07-9d6b6153caee', 'Summit Osteopathic Practice', 'gold', 'gold', DEFAULT, '2026-03-07', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.613578+00', '2026-06-10 18:01:41.616429+00', NULL),
	('2f22d772-2b22-4223-9535-ab36ac19fe98', '32c54111-7ab8-43a4-8037-8fe8dd3a17d0', 'Quayside Foot & Ankle Clinic', 'gold', 'gold', DEFAULT, '2026-03-17', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.623786+00', '2026-06-10 18:01:41.631189+00', NULL),
	('efa99ffc-a38b-4555-85e0-8928f3280c51', '0240efe9-ec87-4037-b00f-9b4ede3fa4b0', 'Clearwater Podiatry', 'gold', 'gold', DEFAULT, '2026-04-21', NULL, '19fca03c-771e-4ac8-ba7d-2108e7c73832', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.637114+00', '2026-06-10 18:01:41.641358+00', NULL),
	('e97c5c08-5084-4fae-a306-b0a03f1e58ab', 'be05f157-9b16-4c5e-b0f2-b822cb3d5b60', 'Vital Health Clinic', 'platinum', 'platinum', DEFAULT, '2026-02-20', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.645846+00', '2026-06-10 18:01:41.650147+00', NULL),
	('23d5223a-8949-404b-9aca-783e14eae49c', '93c2c556-44d6-41ba-b57f-1b5e0ba7d454', 'Motion Chiropractic', 'platinum', 'platinum', DEFAULT, '2026-03-12', NULL, '19fca03c-771e-4ac8-ba7d-2108e7c73832', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.656759+00', '2026-06-10 18:01:41.660126+00', NULL),
	('2746e221-f436-47e0-b997-c67bce25f957', '86cf1ec6-c891-468c-873b-c2325d36d9ac', 'Waverley Physio Clinic', 'active_discussions', 'silver', DEFAULT, '2026-03-27', NULL, '19fca03c-771e-4ac8-ba7d-2108e7c73832', 'Issue NDA and request last 2 years accounts', '2026-06-11', NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.664908+00', '2026-06-10 18:01:41.672861+00', NULL),
	('82d233ce-5ede-4256-b351-16d8a7e438b0', '43451731-48f0-4fc6-9e98-22f9394d7098', 'Hawthorn MSK Clinic', 'due_diligence', 'gold', DEFAULT, '2026-01-31', NULL, '19fca03c-771e-4ac8-ba7d-2108e7c73832', 'Chase outstanding DDQ sections 5–7', '2026-06-09', NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.680095+00', '2026-06-10 18:01:41.691282+00', NULL),
	('b5ee0215-3bb8-46a8-8e17-6ca38059de64', '07e8c8d5-d980-4d48-98c5-1024756e626f', 'Northgate Osteopathic Practice', 'complete', NULL, DEFAULT, '2025-07-25', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, NULL, NULL, '"{}"', '2026-06-10 18:01:41.720224+00', '2026-06-10 18:01:41.729023+00', NULL),
	('0ff5c8a2-ba0e-4006-bc2c-2e12f0f00c3e', '057f7e81-be41-497e-ac99-204310fb4ed4', 'Fairview Chiropractic Clinic', 'reengage', NULL, DEFAULT, '2026-01-21', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, '2026-06-14', NULL, '"{}"', '2026-06-10 18:01:41.736866+00', '2026-06-10 18:01:41.743676+00', NULL),
	('574f1475-a8db-41bf-8107-68538d42cff3', '20af211a-9965-4d21-b7c3-d733efa4090f', 'Silverdale Rehab Centre', 'reengage', NULL, DEFAULT, '2026-02-10', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, '2026-07-05', NULL, '"{}"', '2026-06-10 18:01:41.751087+00', '2026-06-10 18:01:41.753661+00', NULL),
	('447cc1b1-1552-4f46-ab4b-b30c46701347', '5f411982-de5f-4b88-a7d6-32c89febae8f', 'Clearwater Chiropractic', 'dead', 'gold', DEFAULT, '2025-10-13', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', NULL, NULL, NULL, NULL, 'Sold to a rival consolidator — we were second in a two-horse race.', '"{}"', '2026-06-10 18:01:41.760828+00', '2026-06-10 18:01:41.765407+00', NULL),
	('1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'f5856934-85cb-4f3e-8a28-cd64ab6c80d2', 'Hawthorn Physio Clinic', 'hots', NULL, DEFAULT, '2026-01-01', NULL, '54786622-76b3-4642-aeef-d73aaba847c8', 'Agree completion accounts mechanism', '2026-06-18', '2026-05-21 12:00:00+00', NULL, NULL, '"{}"', '2026-06-10 18:01:41.699767+00', '2026-06-10 18:01:41.773239+00', NULL);


--
-- Data for Name: comments; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.comments VALUES
	('a6d3c288-9dbc-4ca1-821c-2a2be678fcb0', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '4317c135-902c-484e-8527-f4e0846df578', 'Impressive retention numbers in the QoE. Keen we hold the line on the earn-out cap — £200k is already generous at this multiple.', '2026-06-10 18:01:41.40494+00', '2026-06-10 18:01:41.40494+00');


--
-- Data for Name: contacts; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.contacts VALUES
	('e474cddd-cea3-4874-b87c-b05d8618c7da', '547de6b4-2f2d-4eb0-82fc-8e47a71038cf', 'Sarah Whitfield', 'owner', '{sarah@riversidephysio.co.uk}', '020 8940 1122', '+447700900123', 'Co-founder with Mark. Clinically active 3 days/week.', NULL, '2026-06-10 18:01:41.187749+00', '2026-06-10 18:01:41.187749+00', NULL),
	('0c0aaf1d-eb2a-487f-9941-4504e578e82f', '547de6b4-2f2d-4eb0-82fc-8e47a71038cf', 'Mark Whitfield', 'director', '{mark@riversidephysio.co.uk,mark.whitfield@gmail.com}', '020 8940 1123', '+447700900124', 'Handles the numbers. Prefers WhatsApp for quick questions.', NULL, '2026-06-10 18:01:41.191344+00', '2026-06-10 18:01:41.191344+00', NULL),
	('cd61729a-01cd-4fbd-bbf0-7e849d59e219', '482b3ccd-ecc9-4c42-b416-3c7d219d8010', 'James Okafor', 'practice_manager', '{james@riversidephysio.co.uk}', NULL, NULL, 'Runs ops across all three sites.', NULL, '2026-06-10 18:01:41.192721+00', '2026-06-10 18:01:41.192721+00', NULL),
	('0036af4e-4943-4d40-b47f-092d544d33ea', NULL, 'Tom Bryce', 'adviser', '{tom@brycecf.co.uk}', '0117 332 8810', NULL, 'Bryce Corporate Finance — sell-side adviser on Riverside.', NULL, '2026-06-10 18:01:41.194518+00', '2026-06-10 18:01:41.194518+00', NULL),
	('5450601a-0346-4fff-a46c-fc0c1a26dc90', NULL, 'Priya Shah', 'solicitor', '{priya.shah@hartleylaw.co.uk}', NULL, NULL, 'Hartley Law — seller solicitors on Riverside (Project Thames).', NULL, '2026-06-10 18:01:41.196112+00', '2026-06-10 18:01:41.196112+00', NULL),
	('549115ae-7bcd-4a4d-a2e7-34bfaf75b7c2', 'c17d2dba-ba1e-4b82-8670-63e0c888e1e8', 'Emma Carlton', 'owner', '{emma@harbornespinesport.co.uk}', NULL, '+447700900201', 'Chiropractor-owner. Wants 2 days/week clinical post-completion.', NULL, '2026-06-10 18:01:41.199175+00', '2026-06-10 18:01:41.199175+00', NULL),
	('63823073-08a2-431d-9236-0e7e95154311', 'f89a374d-bb7d-4944-8554-9e8e92d9886e', 'Fraser McAllister', 'director', '{fraser@caledoniaphysio.co.uk}', NULL, '+447700900215', 'Two minority partners (10% each) to resolve in any structure.', NULL, '2026-06-10 18:01:41.200714+00', '2026-06-10 18:01:41.200714+00', NULL),
	('ecc36381-4965-47ec-ae88-a8a2dcfd993d', '13131a80-0527-472f-81c4-fcf129de7b28', 'Dee Adeyemi', 'owner', '{dee@albionmskclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.202461+00', '2026-06-10 18:01:41.202461+00', NULL),
	('f1fc9faa-cb1a-4fc4-bb0e-fb1d3898385c', '9ca6913c-efa9-4b1c-af56-8be984160382', 'Karen Doyle', 'owner', '{karen@westbourneosteopathy.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.204171+00', '2026-06-10 18:01:41.204171+00', NULL),
	('48a30366-459e-4268-8735-34d6fdc941d9', '74155a6e-57d0-49a8-8997-39d34c7c8dc5', 'Joe Hartley', 'owner', '{joe@thepenninephysioco.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.205637+00', '2026-06-10 18:01:41.205637+00', NULL),
	('7c999ee0-f330-454a-b3c8-edb2b6ca2ee4', '8ff9c0ad-0f6c-4d26-871d-df56c041ffd5', 'Beth Lloyd', 'owner', '{beth@cathedralphysiotherapy.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.206885+00', '2026-06-10 18:01:41.206885+00', NULL),
	('3a89b988-58ba-4657-bbe4-e1b352115a61', '7060c253-7c0f-4118-9a90-cd65eb1514d7', 'Stuart Milne', 'owner', '{stuart@granitecityphysio.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.208198+00', '2026-06-10 18:01:41.208198+00', NULL),
	('8aa31b0c-faed-4abd-b941-ca9752affec9', '2ab4c7c8-83f7-46ea-b141-67191d84f5c3', 'Gemma Price', 'owner', '{gemma@severnsportstherapy.co.uk}', NULL, '+447700900230', NULL, NULL, '2026-06-10 18:01:41.209588+00', '2026-06-10 18:01:41.209588+00', NULL),
	('ec407e3b-e7c5-425c-9988-8d12b4b2565c', '676b8459-cbe9-4757-9c98-2a87f6bdb812', 'Aaron Kemp', 'owner', '{aaron@maplehousechiropractic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.21367+00', '2026-06-10 18:01:41.21367+00', NULL),
	('85c2c124-16b5-44f6-a7df-74852b62f0bc', '9f0739d3-5a83-4575-b718-434f280c8bb5', 'Paul Bennett', 'owner', '{paul@stonebridgephysioclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.215213+00', '2026-06-10 18:01:41.215213+00', NULL),
	('2a07911d-cbb0-481b-bcad-69fc17c44dca', '4e7d14ca-3c89-439d-8100-2f6471e69a08', 'Jamie Fletcher', 'owner', '{jamie@vitalchiropracticclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.217056+00', '2026-06-10 18:01:41.217056+00', NULL),
	('6e07478a-3f33-4e14-b822-9a21e1b6dddd', 'cc5b4c38-5744-4a6e-9f61-4d674181de69', 'Rachel Bennett', 'owner', '{rachel@anchorfootankleclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.219336+00', '2026-06-10 18:01:41.219336+00', NULL),
	('d623a755-c57d-4d2d-b48f-ac9cb5fc756a', 'ad5d678a-7968-4e56-88a0-b2afac88f266', 'Fiona Dawson', 'owner', '{fiona@summitchiropracticclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.220754+00', '2026-06-10 18:01:41.220754+00', NULL),
	('3647c3f8-51a7-4f87-85d2-375cb5a5e6c3', '21125523-2ae9-451a-a2c4-4f1222dab67e', 'Gareth Dawson', 'owner', '{gareth@ironbridgefootankleclini.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.22225+00', '2026-06-10 18:01:41.22225+00', NULL),
	('1d9d87e8-4d11-49d4-bad0-a66c9f8213c4', '0240efe9-ec87-4037-b00f-9b4ede3fa4b0', 'Paul Adams', 'owner', '{paul@clearwaterpodiatry.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.223897+00', '2026-06-10 18:01:41.223897+00', NULL),
	('99a52299-ca06-4dab-91e8-b2360d2d5276', 'be05f157-9b16-4c5e-b0f2-b822cb3d5b60', 'Owen Clarke', 'owner', '{owen@vitalhealthclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.22643+00', '2026-06-10 18:01:41.22643+00', NULL),
	('4281d9eb-75e0-4946-a06e-dd52bb292685', '93c2c556-44d6-41ba-b57f-1b5e0ba7d454', 'Morgan Clarke', 'owner', '{morgan@motionchiropractic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.228044+00', '2026-06-10 18:01:41.228044+00', NULL),
	('0081124b-b864-4577-aca9-2103bfd0d301', '86cf1ec6-c891-468c-873b-c2325d36d9ac', 'Jamie Adams', 'owner', '{jamie@waverleyphysioclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.22938+00', '2026-06-10 18:01:41.22938+00', NULL),
	('b795016b-7c38-4a9f-856e-3d2a88ac961b', '43451731-48f0-4fc6-9e98-22f9394d7098', 'Sam Clarke', 'owner', '{sam@hawthornmskclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.230763+00', '2026-06-10 18:01:41.230763+00', NULL),
	('cb097900-b6f1-46e3-ad0a-d361517e1171', 'f5856934-85cb-4f3e-8a28-cd64ab6c80d2', 'Sam Irwin', 'owner', '{sam@hawthornphysioclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.232239+00', '2026-06-10 18:01:41.232239+00', NULL),
	('dacd0e81-129a-4b4a-a320-a29de519e911', '07e8c8d5-d980-4d48-98c5-1024756e626f', 'Helen Newton', 'owner', '{helen@northgateosteopathicprac.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.233754+00', '2026-06-10 18:01:41.233754+00', NULL),
	('b7e0ab3b-effc-4064-96d9-35471783c8e2', '20af211a-9965-4d21-b7c3-d733efa4090f', 'David Mason', 'owner', '{david@silverdalerehabcentre.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.235359+00', '2026-06-10 18:01:41.235359+00', NULL),
	('3a08e850-7181-428a-974b-6afc49a22dbb', '3dbaaf83-2b65-4cd4-9441-2b95c322c89f', 'Owen Graham', 'owner', '{owen@birchwoodmskclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.237305+00', '2026-06-10 18:01:41.237305+00', NULL),
	('5a570846-5fbd-4891-87e0-b7d43773234b', '217e7b9f-e852-468e-84b4-2edb3944a11d', 'Gareth Jenkins', 'owner', '{gareth@kingswayosteopathy.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.240148+00', '2026-06-10 18:01:41.240148+00', NULL),
	('6c9ec316-90de-41d5-aa08-a4937b88865c', '9786b323-88db-4aac-bf71-8e3c80f6aac8', 'Sam Irwin', 'owner', '{sam@summitrehabcentre.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.241396+00', '2026-06-10 18:01:41.241396+00', NULL),
	('fb7508db-54fe-45a8-9a87-3be881670b18', 'd8a7125f-0fc2-4397-9fff-1e02250793e0', 'Taylor Graham', 'owner', '{taylor@ironbridgerehabcentre.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.243028+00', '2026-06-10 18:01:41.243028+00', NULL),
	('fa820b81-79bb-474b-8c4a-9e2a7a99d4d9', '0795b7e8-6c40-4139-824f-42412d75f645', 'Sam Irwin', 'owner', '{sam@stonebridgesportsphysio.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.2444+00', '2026-06-10 18:01:41.2444+00', NULL),
	('ac304c23-869b-4335-833b-eea20457f72d', '642b64d8-278f-4ed2-b23e-1f118c7ab6c6', 'Sam Graham', 'owner', '{sam@greenwaysportsphysio.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.245995+00', '2026-06-10 18:01:41.245995+00', NULL),
	('b9d9baa8-082d-474e-ba0e-24453a8eaaf9', 'b7ab84a6-22da-4a2f-a5b7-bfd75be6b82d', 'Owen Irwin', 'owner', '{owen@foxglovechiropractic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.247625+00', '2026-06-10 18:01:41.247625+00', NULL),
	('4d659cef-55b8-403a-a41b-9abb641ab252', 'a520b434-6e76-48c8-ad4a-808e287c289d', 'Nicola Lawson', 'owner', '{nicola@birchwoodosteopathy.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.248927+00', '2026-06-10 18:01:41.248927+00', NULL),
	('ac260fb2-8068-4df5-8fd9-22320ec8a1a3', '5215d92b-8748-47b1-a893-b0a566ff4b0d', 'Gareth Graham', 'owner', '{gareth@greenwaypodiatry.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.250858+00', '2026-06-10 18:01:41.250858+00', NULL),
	('7f165e7d-5f17-4512-9253-96588e7061f9', 'a259409f-6c7e-43eb-9d7f-b5f675b3968f', 'Jordan Graham', 'owner', '{jordan@foxglovephysioclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.254657+00', '2026-06-10 18:01:41.254657+00', NULL),
	('3620b6e5-c4ac-403a-b64d-f35431fee49c', '5ee099ae-707a-491c-bc5e-ac7a3438bb67', 'Nicola Bennett', 'owner', '{nicola@foxglovehealthclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.25621+00', '2026-06-10 18:01:41.25621+00', NULL),
	('34febe82-bacd-43b1-9910-a82bdd6f4127', '44f017c1-875f-46de-84de-275d200b17c6', 'Robin Fletcher', 'owner', '{robin@redwoodmskclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.259468+00', '2026-06-10 18:01:41.259468+00', NULL),
	('fa31204b-41a8-4e7c-8cb0-de89aa1bfe52', 'd457a649-c169-41cb-9cdd-6566922d481f', 'Casey Knight', 'owner', '{casey@trinitypodiatry.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.261078+00', '2026-06-10 18:01:41.261078+00', NULL),
	('75458e9c-2f7f-4203-9189-ea99c60cfd38', '37fdc85d-44fb-419d-9eaa-c1bf648740bd', 'Rachel Lawson', 'owner', '{rachel@northgaterehabcentre.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.262549+00', '2026-06-10 18:01:41.262549+00', NULL),
	('838ca625-a96b-4ae3-a189-ea7c8bba2e85', '4e583df0-6a47-4bb5-b6ac-37c95423d300', 'Taylor Knight', 'owner', '{taylor@apexchiropracticclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.263899+00', '2026-06-10 18:01:41.263899+00', NULL),
	('6ea7a092-71da-43a4-9356-de086061f4b2', '9a58f5a2-e8e5-4dc2-be71-4835639a3de7', 'Fiona Dawson', 'owner', '{fiona@greenwayhealthclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.265121+00', '2026-06-10 18:01:41.265121+00', NULL),
	('181a5114-a464-4580-bcdb-37b7cf547b83', 'ae60f951-eb63-40f7-8157-aed7cf32b6de', 'David Parker', 'owner', '{david@waverleypodiatry.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.268982+00', '2026-06-10 18:01:41.268982+00', NULL),
	('3dee7a98-06f1-44be-a7c1-a91cf56278bb', '454ef13a-4dee-42b5-a177-2c5ba9da2371', 'Sam Clarke', 'owner', '{sam@waverleyosteopathicpract.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.270482+00', '2026-06-10 18:01:41.270482+00', NULL),
	('f9b467e6-3e6f-4fd0-b1d1-9812c753bbcb', '38dd6c2c-0f48-4f03-b0ab-eb2d3650a0f7', 'Paul Fletcher', 'owner', '{paul@silverdaleosteopathy.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.271749+00', '2026-06-10 18:01:41.271749+00', NULL),
	('29c7c5c0-8deb-45e4-b718-044fd707d4a1', '1510db1c-fe21-4252-873f-5eafc953be64', 'Casey Ellis', 'owner', '{casey@trinityhealthclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.27311+00', '2026-06-10 18:01:41.27311+00', NULL),
	('d7c30e7b-a338-49ee-a824-de8a1b76a963', 'a3354a0d-0c4f-47b3-9a81-f5d6d2f28a8d', 'Jordan Hughes', 'owner', '{jordan@kingswaysportsphysio.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.2751+00', '2026-06-10 18:01:41.2751+00', NULL),
	('a2de78ff-8daa-4c52-b52e-a36e833a7ad8', '1bd94efe-a254-43a2-8743-c0b336e64fa1', 'Casey Newton', 'owner', '{casey@redwoodchiropracticclini.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.276307+00', '2026-06-10 18:01:41.276307+00', NULL),
	('91737403-5494-4cb9-8db6-fa15292714d6', '72a8bc5d-cd17-4b21-86a1-2f4a1b716f2f', 'Taylor Ellis', 'owner', '{taylor@redwoodrehabcentre.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.277525+00', '2026-06-10 18:01:41.277525+00', NULL);
INSERT INTO public.contacts VALUES
	('248b90b9-e858-4fc9-b45c-934ed7366e23', 'd2889409-cacc-4304-b746-ac5e7b181786', 'Casey Clarke', 'owner', '{casey@lakesidesportsphysio.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.278813+00', '2026-06-10 18:01:41.278813+00', NULL),
	('8e32e962-1042-4147-ac85-cea5af980e0a', 'a6655bcf-6fff-4c7f-970d-f42014170075', 'Taylor Ellis', 'owner', '{taylor@redwoodosteopathicpracti.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.281304+00', '2026-06-10 18:01:41.281304+00', NULL),
	('de9cf440-8ddd-4658-a1a4-d25a4a583f23', 'bb9b255c-2365-450d-9336-b4378d298a6f', 'Alex Osborne', 'owner', '{alex@ironbridgephysioclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.282533+00', '2026-06-10 18:01:41.282533+00', NULL),
	('00b0fcf4-cc3b-47e2-9c48-da500f459766', 'a6f85349-6098-453b-876f-d3f3a43bb7da', 'Robin Knight', 'owner', '{robin@beaconmskclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.28368+00', '2026-06-10 18:01:41.28368+00', NULL),
	('0f5d08a7-e7f7-4bb8-ab7f-2b8307de5102', '1dcc7fff-1c5f-4103-83a8-2fc1c31be5ba', 'Nicola Fletcher', 'owner', '{nicola@lakesidechiropracticclin.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.284818+00', '2026-06-10 18:01:41.284818+00', NULL),
	('ea921381-1856-4290-a993-282feed2f818', 'e28ad9d9-b042-4f6d-b37a-127e7f788e12', 'Jamie Osborne', 'owner', '{jamie@hawthornphysiotherapy.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.285995+00', '2026-06-10 18:01:41.285995+00', NULL),
	('d3b3bd4c-4b1e-4139-96ba-eeed06812177', 'bc1531fb-4e72-414e-bd9c-0ea104782853', 'Fiona Graham', 'owner', '{fiona@juniperhealthclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.287402+00', '2026-06-10 18:01:41.287402+00', NULL),
	('18fd4f82-7ee2-43d5-ac37-f689f12b1ee2', 'bfbc7ce8-0ca0-4254-9327-f442fdfa9598', 'Jordan Jenkins', 'owner', '{jordan@northgatechiropracticcli.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.28861+00', '2026-06-10 18:01:41.28861+00', NULL),
	('4cbef722-943d-41bc-83e0-e11883cef40b', 'acbbe2c9-879a-4025-ba8c-eff1a552a37b', 'Rachel Irwin', 'owner', '{rachel@meadowpodiatry.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.291146+00', '2026-06-10 18:01:41.291146+00', NULL),
	('d5e7ed1c-215a-451c-93af-f8851182a2ec', 'ab7bbf74-7ef3-4a2f-af5e-e0b49d85bc5b', 'Owen Bennett', 'owner', '{owen@kingswayfootankleclinic.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.292549+00', '2026-06-10 18:01:41.292549+00', NULL),
	('7a61fd0b-893b-48d8-bd4f-904811936ec3', 'd980989d-9638-415a-a7ba-4a3b3817773a', 'Sam Dawson', 'owner', '{sam@lakesiderehabcentre.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.293837+00', '2026-06-10 18:01:41.293837+00', NULL),
	('e75e3d6d-0c32-4211-8722-d644d7b573c2', 'af3ce9d4-fc40-4b24-b3be-09efa6f4a58a', 'Sam Knight', 'owner', '{sam@quaysideosteopathy.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.295264+00', '2026-06-10 18:01:41.295264+00', NULL),
	('12442ef6-7692-49de-95fb-7ea064d77717', '6d9658f7-8213-4a59-abb6-dc342a86ba8a', 'David Newton', 'owner', '{david@meadowphysiotherapy.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.296717+00', '2026-06-10 18:01:41.296717+00', NULL),
	('418a7cc3-e363-4ea5-93ae-50246b6d5a31', 'b2fe9f11-9570-4fe1-8465-1f17e2b3e2b4', 'Robin Irwin', 'owner', '{robin@anchorrehabcentre.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.298118+00', '2026-06-10 18:01:41.298118+00', NULL),
	('f9548aad-3f3f-4187-9088-e2dc4684a90f', '845d9508-6eeb-4181-9e7b-5b41a26079f5', 'Fiona Osborne', 'owner', '{fiona@vitalphysiotherapy.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.299469+00', '2026-06-10 18:01:41.299469+00', NULL),
	('6fc109e0-b293-4bf9-9a35-a8f66d711839', '6b2f5f18-75e1-4be2-9762-c8b192a2bddb', 'Alex Fletcher', 'owner', '{alex@redwoodphysiotherapy.co.uk}', NULL, NULL, NULL, NULL, '2026-06-10 18:01:41.300726+00', '2026-06-10 18:01:41.300726+00', NULL);


--
-- Data for Name: deal_access; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.deal_access VALUES
	('9949d473-c565-45b2-94f7-982765c53ec5', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '2026-06-10 18:01:41.829427+00'),
	('9949d473-c565-45b2-94f7-982765c53ec5', '18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', '2026-06-10 18:01:41.829427+00');


--
-- Data for Name: deal_checklists; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.deal_checklists VALUES
	('ecef5f01-0a36-4a28-9746-fc929a857b65', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'f2ab54bb-9547-4299-8184-dfa2afbe1df0', 'Due Diligence Pack', '2026-06-10 18:01:41.322656+00', '2026-06-10 18:01:41.322656+00'),
	('4eb75770-abfb-4338-9c8a-91fe6514365a', '18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', 'f2ab54bb-9547-4299-8184-dfa2afbe1df0', 'Due Diligence Pack', '2026-06-10 18:01:41.417182+00', '2026-06-10 18:01:41.417182+00'),
	('2bdb5549-86a9-4c4e-981c-d560b83496a1', '67536aed-097d-4f18-9f85-5392db23ccca', 'f2ab54bb-9547-4299-8184-dfa2afbe1df0', 'Due Diligence Pack', '2026-06-10 18:01:41.493077+00', '2026-06-10 18:01:41.493077+00'),
	('5b7b1ab3-d209-4aba-a94b-bb9ec2db2f46', '82d233ce-5ede-4256-b351-16d8a7e438b0', 'f2ab54bb-9547-4299-8184-dfa2afbe1df0', 'Due Diligence Pack', '2026-06-10 18:01:41.685648+00', '2026-06-10 18:01:41.685648+00'),
	('9ea4fa60-7e60-49c0-b060-b83ea5837a18', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'f2ab54bb-9547-4299-8184-dfa2afbe1df0', 'Due Diligence Pack', '2026-06-10 18:01:41.705752+00', '2026-06-10 18:01:41.705752+00'),
	('71d07561-8f91-4a63-b7e3-91132e02a4cb', 'b5ee0215-3bb8-46a8-8e17-6ca38059de64', 'f2ab54bb-9547-4299-8184-dfa2afbe1df0', 'Due Diligence Pack', '2026-06-10 18:01:41.724562+00', '2026-06-10 18:01:41.724562+00');


--
-- Data for Name: deal_checklist_items; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.deal_checklist_items VALUES
	('1b484cd1-fe2b-4e35-80d8-548463dd4601', 'ecef5f01-0a36-4a28-9746-fc929a857b65', 'Financial DD (QoE)', 1, 'done', 'kinetico', NULL, 'QoE report received from Forsters — no red flags; normalised EBITDA £405k confirmed.', '2026-06-10 18:01:41.322656+00', '2026-06-10 18:01:41.370188+00'),
	('cbaa9277-d232-4e37-a246-ad05ed53e21b', 'ecef5f01-0a36-4a28-9746-fc929a857b65', 'Legal DD', 2, 'in_progress', 'buyer_solicitors', NULL, 'Awaiting responses on warranty cap + restrictive covenants.', '2026-06-10 18:01:41.322656+00', '2026-06-10 18:01:41.37189+00'),
	('714cad98-e2d9-4501-ab77-8acd4788d794', 'ecef5f01-0a36-4a28-9746-fc929a857b65', 'Property & leases review', 3, 'in_progress', 'buyer_solicitors', NULL, 'Putney CoC consent in motion; Kingston notification drafted.', '2026-06-10 18:01:41.322656+00', '2026-06-10 18:01:41.373175+00'),
	('2c9095dc-0c98-4581-bdae-9a119d5a8fa1', 'ecef5f01-0a36-4a28-9746-fc929a857b65', 'Clinical/regulatory (CQC, HTM 01-05, IRMER)', 4, 'done', 'kinetico', NULL, 'All sites compliant; last CQC visit Jan — Good.', '2026-06-10 18:01:41.322656+00', '2026-06-10 18:01:41.375411+00'),
	('fe86888c-1e5d-4d6c-8981-8d3704bd5756', 'ecef5f01-0a36-4a28-9746-fc929a857b65', 'Employment & contractors', 5, 'open', 'sellers', NULL, NULL, '2026-06-10 18:01:41.322656+00', '2026-06-10 18:01:41.377076+00'),
	('8b578157-58c7-4835-ac1d-63adf2402f80', 'ecef5f01-0a36-4a28-9746-fc929a857b65', 'IT & data', 6, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.322656+00', '2026-06-10 18:01:41.378441+00'),
	('31b8ae82-bb7e-47bc-a83b-c8603b629064', 'ecef5f01-0a36-4a28-9746-fc929a857b65', 'Insurance', 7, 'n/a', 'sellers', NULL, 'Group policy supersedes — confirmed with brokers.', '2026-06-10 18:01:41.322656+00', '2026-06-10 18:01:41.379662+00'),
	('e6620517-d31e-4447-b4fa-6cd5d6f5d0bd', '4eb75770-abfb-4338-9c8a-91fe6514365a', 'Financial DD (QoE)', 1, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.417182+00', '2026-06-10 18:01:41.417182+00'),
	('56d74b45-59da-4c92-bc29-9332a6c0f5aa', '4eb75770-abfb-4338-9c8a-91fe6514365a', 'Legal DD', 2, 'open', 'buyer_solicitors', NULL, NULL, '2026-06-10 18:01:41.417182+00', '2026-06-10 18:01:41.417182+00'),
	('39b642a2-0d0d-4c2e-b1ae-305fd0f8df78', '4eb75770-abfb-4338-9c8a-91fe6514365a', 'Property & leases review', 3, 'open', 'buyer_solicitors', NULL, NULL, '2026-06-10 18:01:41.417182+00', '2026-06-10 18:01:41.417182+00'),
	('ff576c15-fff8-4381-9413-5f81553180e7', '4eb75770-abfb-4338-9c8a-91fe6514365a', 'Clinical/regulatory (CQC, HTM 01-05, IRMER)', 4, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.417182+00', '2026-06-10 18:01:41.417182+00'),
	('b7936bd0-61fd-44d3-8ecb-f42938bca4ce', '4eb75770-abfb-4338-9c8a-91fe6514365a', 'Employment & contractors', 5, 'open', 'sellers', NULL, NULL, '2026-06-10 18:01:41.417182+00', '2026-06-10 18:01:41.417182+00'),
	('05412d26-d5f8-4656-a257-28cd15eac5e3', '4eb75770-abfb-4338-9c8a-91fe6514365a', 'IT & data', 6, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.417182+00', '2026-06-10 18:01:41.417182+00'),
	('a95dddc1-5212-4caf-b9ca-f7e050201398', '4eb75770-abfb-4338-9c8a-91fe6514365a', 'Insurance', 7, 'open', 'sellers', NULL, NULL, '2026-06-10 18:01:41.417182+00', '2026-06-10 18:01:41.417182+00'),
	('b5025be1-faa2-4940-8e2a-fe51c3c766f2', '2bdb5549-86a9-4c4e-981c-d560b83496a1', 'Financial DD (QoE)', 1, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.493077+00', '2026-06-10 18:01:41.493077+00'),
	('9766de12-b626-493c-93e0-9a9571684db0', '2bdb5549-86a9-4c4e-981c-d560b83496a1', 'Legal DD', 2, 'open', 'buyer_solicitors', NULL, NULL, '2026-06-10 18:01:41.493077+00', '2026-06-10 18:01:41.493077+00'),
	('7ed040c1-271f-4ca8-b607-48661be88774', '2bdb5549-86a9-4c4e-981c-d560b83496a1', 'Property & leases review', 3, 'open', 'buyer_solicitors', NULL, NULL, '2026-06-10 18:01:41.493077+00', '2026-06-10 18:01:41.493077+00'),
	('59246535-edb9-4cc0-a577-993434ba2479', '2bdb5549-86a9-4c4e-981c-d560b83496a1', 'Clinical/regulatory (CQC, HTM 01-05, IRMER)', 4, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.493077+00', '2026-06-10 18:01:41.493077+00'),
	('4e6b23ab-1396-469a-b57a-42a8ffa1be84', '2bdb5549-86a9-4c4e-981c-d560b83496a1', 'Employment & contractors', 5, 'open', 'sellers', NULL, NULL, '2026-06-10 18:01:41.493077+00', '2026-06-10 18:01:41.493077+00'),
	('e1481116-6c2f-4825-8a34-8e1266910d57', '2bdb5549-86a9-4c4e-981c-d560b83496a1', 'IT & data', 6, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.493077+00', '2026-06-10 18:01:41.493077+00'),
	('16144335-4ee1-41c9-946f-892e4b5d849f', '2bdb5549-86a9-4c4e-981c-d560b83496a1', 'Insurance', 7, 'open', 'sellers', NULL, NULL, '2026-06-10 18:01:41.493077+00', '2026-06-10 18:01:41.493077+00'),
	('efb707fc-f44c-4407-9f76-24489e008d37', '5b7b1ab3-d209-4aba-a94b-bb9ec2db2f46', 'Financial DD (QoE)', 1, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.685648+00', '2026-06-10 18:01:41.685648+00'),
	('fafcf596-a3a7-40d2-8c72-da85dd4e257b', '5b7b1ab3-d209-4aba-a94b-bb9ec2db2f46', 'Legal DD', 2, 'open', 'buyer_solicitors', NULL, NULL, '2026-06-10 18:01:41.685648+00', '2026-06-10 18:01:41.685648+00'),
	('0cb04020-bec5-4fb5-9627-a5c6e9dcb083', '5b7b1ab3-d209-4aba-a94b-bb9ec2db2f46', 'Property & leases review', 3, 'open', 'buyer_solicitors', NULL, NULL, '2026-06-10 18:01:41.685648+00', '2026-06-10 18:01:41.685648+00'),
	('5ca8af4e-c64c-40f7-887b-59caaa5a459e', '5b7b1ab3-d209-4aba-a94b-bb9ec2db2f46', 'Clinical/regulatory (CQC, HTM 01-05, IRMER)', 4, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.685648+00', '2026-06-10 18:01:41.685648+00'),
	('8cef97ce-320a-4734-9ff5-6fa71e718d84', '5b7b1ab3-d209-4aba-a94b-bb9ec2db2f46', 'Employment & contractors', 5, 'open', 'sellers', NULL, NULL, '2026-06-10 18:01:41.685648+00', '2026-06-10 18:01:41.685648+00'),
	('6a86e35e-a84a-48e2-b8fd-f93150ce6e13', '5b7b1ab3-d209-4aba-a94b-bb9ec2db2f46', 'IT & data', 6, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.685648+00', '2026-06-10 18:01:41.685648+00'),
	('03b4e2de-ca9e-401e-b00e-45d6b3069565', '5b7b1ab3-d209-4aba-a94b-bb9ec2db2f46', 'Insurance', 7, 'open', 'sellers', NULL, NULL, '2026-06-10 18:01:41.685648+00', '2026-06-10 18:01:41.685648+00'),
	('f7653532-05c5-4971-880e-512b69be26cd', '9ea4fa60-7e60-49c0-b060-b83ea5837a18', 'Financial DD (QoE)', 1, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.705752+00', '2026-06-10 18:01:41.705752+00'),
	('88abb573-9e3a-436c-9f96-921148399ffd', '9ea4fa60-7e60-49c0-b060-b83ea5837a18', 'Legal DD', 2, 'open', 'buyer_solicitors', NULL, NULL, '2026-06-10 18:01:41.705752+00', '2026-06-10 18:01:41.705752+00'),
	('9ee736db-0d2c-4ca7-b2c1-7e66a89eea99', '9ea4fa60-7e60-49c0-b060-b83ea5837a18', 'Property & leases review', 3, 'open', 'buyer_solicitors', NULL, NULL, '2026-06-10 18:01:41.705752+00', '2026-06-10 18:01:41.705752+00'),
	('779c3bcb-b399-4f1e-bdb1-acf289fc61fb', '9ea4fa60-7e60-49c0-b060-b83ea5837a18', 'Clinical/regulatory (CQC, HTM 01-05, IRMER)', 4, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.705752+00', '2026-06-10 18:01:41.705752+00'),
	('83c94db7-1f1b-4426-b6e8-ac2da49441c9', '9ea4fa60-7e60-49c0-b060-b83ea5837a18', 'Employment & contractors', 5, 'open', 'sellers', NULL, NULL, '2026-06-10 18:01:41.705752+00', '2026-06-10 18:01:41.705752+00'),
	('2c97765f-d2d8-4a8d-9dd8-c5cd8f44e04d', '9ea4fa60-7e60-49c0-b060-b83ea5837a18', 'IT & data', 6, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.705752+00', '2026-06-10 18:01:41.705752+00'),
	('a9be1763-e8da-47c4-a3dc-ee63649e7551', '9ea4fa60-7e60-49c0-b060-b83ea5837a18', 'Insurance', 7, 'open', 'sellers', NULL, NULL, '2026-06-10 18:01:41.705752+00', '2026-06-10 18:01:41.705752+00'),
	('5fcd48ea-5e95-499f-923e-0055aab804f2', '71d07561-8f91-4a63-b7e3-91132e02a4cb', 'Financial DD (QoE)', 1, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.724562+00', '2026-06-10 18:01:41.724562+00'),
	('0e2b7ba4-2807-4b9c-b27d-3d951b4d05d1', '71d07561-8f91-4a63-b7e3-91132e02a4cb', 'Legal DD', 2, 'open', 'buyer_solicitors', NULL, NULL, '2026-06-10 18:01:41.724562+00', '2026-06-10 18:01:41.724562+00'),
	('9d801540-36a8-479d-9cc2-6b10a84a9dc3', '71d07561-8f91-4a63-b7e3-91132e02a4cb', 'Property & leases review', 3, 'open', 'buyer_solicitors', NULL, NULL, '2026-06-10 18:01:41.724562+00', '2026-06-10 18:01:41.724562+00'),
	('42b0e241-5cef-4e70-8187-19a17af0158f', '71d07561-8f91-4a63-b7e3-91132e02a4cb', 'Clinical/regulatory (CQC, HTM 01-05, IRMER)', 4, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.724562+00', '2026-06-10 18:01:41.724562+00'),
	('aaa78ff5-f864-474e-a060-24011670aea0', '71d07561-8f91-4a63-b7e3-91132e02a4cb', 'Employment & contractors', 5, 'open', 'sellers', NULL, NULL, '2026-06-10 18:01:41.724562+00', '2026-06-10 18:01:41.724562+00'),
	('ccb278fc-880b-4875-a245-1a5cb68429ac', '71d07561-8f91-4a63-b7e3-91132e02a4cb', 'IT & data', 6, 'open', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.724562+00', '2026-06-10 18:01:41.724562+00'),
	('690764b0-d5e6-4062-b7fc-b58cfb1b246a', '71d07561-8f91-4a63-b7e3-91132e02a4cb', 'Insurance', 7, 'open', 'sellers', NULL, NULL, '2026-06-10 18:01:41.724562+00', '2026-06-10 18:01:41.724562+00');


--
-- Data for Name: deal_clinics; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.deal_clinics VALUES
	('6fcddeee-03dc-4aa9-9e55-045cf9afc762', '547de6b4-2f2d-4eb0-82fc-8e47a71038cf', '2026-06-10 18:01:41.310796+00'),
	('6fcddeee-03dc-4aa9-9e55-045cf9afc762', '482b3ccd-ecc9-4c42-b416-3c7d219d8010', '2026-06-10 18:01:41.314219+00'),
	('6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'f028b708-3931-481d-a5e7-59689d71ead1', '2026-06-10 18:01:41.316209+00'),
	('18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', 'c17d2dba-ba1e-4b82-8670-63e0c888e1e8', '2026-06-10 18:01:41.410312+00'),
	('a6ed8ae6-278c-42aa-a755-89609dd587af', 'f89a374d-bb7d-4944-8554-9e8e92d9886e', '2026-06-10 18:01:41.437769+00'),
	('4cd719b8-eddb-4486-8ce1-9d34a74729a4', '13131a80-0527-472f-81c4-fcf129de7b28', '2026-06-10 18:01:41.45046+00'),
	('a45b01a2-cec5-4e1c-8306-e9d0a4b60077', '9ca6913c-efa9-4b1c-af56-8be984160382', '2026-06-10 18:01:41.464418+00'),
	('027f5758-2aa8-4232-bb83-cbd52d40e30e', '74155a6e-57d0-49a8-8997-39d34c7c8dc5', '2026-06-10 18:01:41.477758+00'),
	('67536aed-097d-4f18-9f85-5392db23ccca', '8ff9c0ad-0f6c-4d26-871d-df56c041ffd5', '2026-06-10 18:01:41.488428+00'),
	('1b6bc658-ec5d-4bde-bcd4-604db6721e8a', '7060c253-7c0f-4118-9a90-cd65eb1514d7', '2026-06-10 18:01:41.511659+00'),
	('1161e808-2817-4f47-8b14-d9c8863dcba1', '2ab4c7c8-83f7-46ea-b141-67191d84f5c3', '2026-06-10 18:01:41.521829+00'),
	('2cd37272-e23d-4934-9cff-432c8573f33f', '676b8459-cbe9-4757-9c98-2a87f6bdb812', '2026-06-10 18:01:41.535342+00'),
	('4231a51e-56d4-4957-937a-783ada5369fd', '66f8a271-45f3-45aa-9791-9ae97d1ca766', '2026-06-10 18:01:41.543496+00'),
	('1e59e645-ba91-4434-9b42-05b356a17b97', '9f0739d3-5a83-4575-b718-434f280c8bb5', '2026-06-10 18:01:41.552534+00'),
	('3b2d2fa1-9ea6-42a2-ad8a-374a7ded2e50', '4e7d14ca-3c89-439d-8100-2f6471e69a08', '2026-06-10 18:01:41.559369+00'),
	('e177b41b-d749-4cd0-8e69-25b953dac288', 'c0b4b841-77da-4592-a489-e756d7a74e4a', '2026-06-10 18:01:41.567771+00'),
	('97d20fa2-de94-4e10-bb18-1a18bd3b5a04', 'cc5b4c38-5744-4a6e-9f61-4d674181de69', '2026-06-10 18:01:41.575439+00'),
	('d1e5a6c0-d634-4c64-a2d7-32bb0ef42834', 'ad5d678a-7968-4e56-88a0-b2afac88f266', '2026-06-10 18:01:41.581632+00'),
	('e51280ba-d3b2-46e6-b213-286cfbcd4079', '21125523-2ae9-451a-a2c4-4f1222dab67e', '2026-06-10 18:01:41.587967+00'),
	('c4655cb1-a961-4e53-b532-be7aa623c880', '41ccf277-a5e0-4d59-bf34-7a645c7cc8a3', '2026-06-10 18:01:41.598202+00'),
	('b11d9e25-d742-48eb-8454-5e654f9eb885', 'eef6c4ea-3bf5-40f9-8fe0-d6ea22b5515f', '2026-06-10 18:01:41.606855+00'),
	('bacc0c31-58db-455f-b5d9-4593df0f9759', '007ac3f9-7c3f-4791-be07-9d6b6153caee', '2026-06-10 18:01:41.615124+00'),
	('2f22d772-2b22-4223-9535-ab36ac19fe98', '32c54111-7ab8-43a4-8037-8fe8dd3a17d0', '2026-06-10 18:01:41.627951+00'),
	('efa99ffc-a38b-4555-85e0-8928f3280c51', '0240efe9-ec87-4037-b00f-9b4ede3fa4b0', '2026-06-10 18:01:41.63997+00'),
	('e97c5c08-5084-4fae-a306-b0a03f1e58ab', 'be05f157-9b16-4c5e-b0f2-b822cb3d5b60', '2026-06-10 18:01:41.647183+00'),
	('23d5223a-8949-404b-9aca-783e14eae49c', '93c2c556-44d6-41ba-b57f-1b5e0ba7d454', '2026-06-10 18:01:41.658462+00'),
	('2746e221-f436-47e0-b997-c67bce25f957', '86cf1ec6-c891-468c-873b-c2325d36d9ac', '2026-06-10 18:01:41.666352+00'),
	('82d233ce-5ede-4256-b351-16d8a7e438b0', '43451731-48f0-4fc6-9e98-22f9394d7098', '2026-06-10 18:01:41.681603+00'),
	('1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'f5856934-85cb-4f3e-8a28-cd64ab6c80d2', '2026-06-10 18:01:41.701043+00'),
	('b5ee0215-3bb8-46a8-8e17-6ca38059de64', '07e8c8d5-d980-4d48-98c5-1024756e626f', '2026-06-10 18:01:41.721924+00'),
	('0ff5c8a2-ba0e-4006-bc2c-2e12f0f00c3e', '057f7e81-be41-497e-ac99-204310fb4ed4', '2026-06-10 18:01:41.738328+00'),
	('574f1475-a8db-41bf-8107-68538d42cff3', '20af211a-9965-4d21-b7c3-d733efa4090f', '2026-06-10 18:01:41.752553+00'),
	('447cc1b1-1552-4f46-ab4b-b30c46701347', '5f411982-de5f-4b88-a7d6-32c89febae8f', '2026-06-10 18:01:41.762617+00');


--
-- Data for Name: properties; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.properties VALUES
	('e339aa7e-4952-4d51-b3b6-cf61b1632121', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'f028b708-3931-481d-a5e7-59689d71ead1', '88 Lower Richmond Road, Putney SW15 1LN', true, 38000, '2017-03-25', '2027-03-24', NULL, 10, 'consent_required', true, 'Thamesbank Estates Ltd', 'Landlord consent process started — consent letter received, awaiting engrossment.', '2026-06-10 18:01:41.340353+00', '2026-06-10 18:01:41.340353+00'),
	('2c43ed94-23a5-48a1-88bc-2297093e7070', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '482b3ccd-ecc9-4c42-b416-3c7d219d8010', '3 Market Place, Kingston upon Thames KT1 1JT', true, 27500, '2021-06-24', '2031-06-23', '2026-06-24', 10, 'notify_only', true, 'Kingston Market Holdings', 'Break date imminent — do NOT trigger; notification letter drafted.', '2026-06-10 18:01:41.340353+00', '2026-06-10 18:01:41.340353+00'),
	('810e49a5-206e-46c9-b5f5-cb2fba5cb9d7', '18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', 'c17d2dba-ba1e-4b82-8670-63e0c888e1e8', '212 High Street, Birmingham B17 9PT', true, 24000, '2019-09-29', '2029-09-28', NULL, 10, 'unknown', true, 'Calthorpe Estates', NULL, '2026-06-10 18:01:41.430207+00', '2026-06-10 18:01:41.430207+00'),
	('e8c58e01-c26e-4b5d-b6ce-65c3ffc0d58c', '1161e808-2817-4f47-8b14-d9c8863dcba1', '2ab4c7c8-83f7-46ea-b141-67191d84f5c3', 'Unit 4, Docks Way, Gloucester GL1 2EH', true, 19500, NULL, '2028-02-01', NULL, 6, 'consent_required', false, 'Pearce Property', NULL, '2026-06-10 18:01:41.531837+00', '2026-06-10 18:01:41.531837+00'),
	('5d062069-22db-4619-ab46-b51eff02b351', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'f5856934-85cb-4f3e-8a28-cd64ab6c80d2', '137 High Street, Sheffield S1 5EH', true, 21000, NULL, '2030-03-01', NULL, 8, 'notify_only', true, 'Private landlord', NULL, '2026-06-10 18:01:41.771494+00', '2026-06-10 18:01:41.771494+00');


--
-- Data for Name: documents; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.documents VALUES
	('71db3abd-f4c1-4a5f-aad6-955f3c00bf6e', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'earn_out', 'Earn-out Agreement', NULL, NULL, 'other', 'not_started', 'buyer_solicitors', NULL, NULL, '2026-06-10 18:01:41.342859+00', '2026-06-10 18:01:41.342859+00'),
	('b724c579-9093-4613-b867-d7e0be6581ec', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'employment_contracts', 'Employment Contracts', NULL, NULL, 'other', 'not_started', 'sellers', NULL, NULL, '2026-06-10 18:01:41.342859+00', '2026-06-10 18:01:41.342859+00'),
	('5a1193fb-243c-4271-8ba9-aa70a0942177', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'spa', 'Share Purchase Agreement', 'v3', 'https://kinetico.sharepoint.com/sites/MA/Shared%20Documents/Riverside/Riverside_SPA_v3.docx', 'sharepoint', 'with_sellers', 'buyer_solicitors', '2026-06-15', NULL, '2026-06-10 18:01:41.342859+00', '2026-06-10 18:01:41.356599+00'),
	('d8411b1e-f45b-489e-a384-6e643c54cd5b', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'loan_notes', 'Loan Note Instrument', 'v1', NULL, 'word', 'drafting', 'buyer_solicitors', '2026-06-19', NULL, '2026-06-10 18:01:41.342859+00', '2026-06-10 18:01:41.358184+00'),
	('0889d2d6-b013-4bc5-9b09-13eeaa97b3b3', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'ddq', 'Due Diligence Questionnaire', NULL, 'https://kinetico.sharepoint.com/sites/MA/Shared%20Documents/Riverside/Riverside_DDQ_responses.pdf', 'sharepoint', 'agreed', 'sellers', NULL, NULL, '2026-06-10 18:01:41.342859+00', '2026-06-10 18:01:41.359682+00'),
	('ef7f29ad-70dd-4249-81ea-8965914cfd8c', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'lease', 'Lease — 88 Lower Richmond Road, Putney SW15 1LN', NULL, 'https://kinetico.sharepoint.com/sites/MA/Shared%20Documents/Riverside/Putney_lease_consent_letter.pdf', 'sharepoint', 'issued', 'seller_solicitors', '2026-06-22', 'e339aa7e-4952-4d51-b3b6-cf61b1632121', '2026-06-10 18:01:41.342859+00', '2026-06-10 18:01:41.361245+00'),
	('d2c5ad27-3bc2-4b7e-b0d1-3bd5126aed1b', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'lease', 'Lease — 3 Market Place, Kingston upon Thames KT1 1JT', NULL, NULL, 'other', 'agreed', 'seller_solicitors', NULL, '2c43ed94-23a5-48a1-88bc-2297093e7070', '2026-06-10 18:01:41.342859+00', '2026-06-10 18:01:41.36315+00'),
	('82129b64-aa71-4433-b53e-301df4c890ad', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'disclosure_letter', 'Disclosure Letter', NULL, NULL, 'other', 'drafting', 'sellers', '2026-06-24', NULL, '2026-06-10 18:01:41.342859+00', '2026-06-10 18:01:41.364629+00'),
	('59fe58ef-f4fb-406f-9fff-02905c5baeb2', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'hots', 'Heads of Terms', 'final', 'https://kinetico.sharepoint.com/sites/MA/Shared%20Documents/Riverside/Riverside_HoTs_signed.pdf', 'sharepoint', 'signed', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.342859+00', '2026-06-10 18:01:41.367554+00'),
	('6d6779a2-54d6-401d-83b2-b341e21d6e57', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'hots', 'Heads of Terms', NULL, NULL, 'other', 'signed', 'kinetico', NULL, NULL, '2026-06-10 18:01:41.773239+00', '2026-06-10 18:01:41.773239+00'),
	('675e6524-614c-4dd5-be97-f3b13b69a586', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'loan_notes', 'Loan Note Instrument', NULL, NULL, 'other', 'not_started', 'buyer_solicitors', NULL, NULL, '2026-06-10 18:01:41.773239+00', '2026-06-10 18:01:41.773239+00'),
	('4d416e77-6bbe-469c-9f65-fedc3f028508', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'earn_out', 'Earn-out Agreement', NULL, NULL, 'other', 'not_started', 'buyer_solicitors', NULL, NULL, '2026-06-10 18:01:41.773239+00', '2026-06-10 18:01:41.773239+00'),
	('99352373-4002-4a00-b588-7442cd5e36aa', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'employment_contracts', 'Employment Contracts', NULL, NULL, 'other', 'not_started', 'sellers', NULL, NULL, '2026-06-10 18:01:41.773239+00', '2026-06-10 18:01:41.773239+00'),
	('0eac282a-9b5a-40cf-a537-64e5a6de5ba9', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'disclosure_letter', 'Disclosure Letter', NULL, NULL, 'other', 'not_started', 'seller_solicitors', NULL, NULL, '2026-06-10 18:01:41.773239+00', '2026-06-10 18:01:41.773239+00'),
	('ae18d239-61e0-4655-9499-1971c45c103b', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'lease', 'Lease — 137 High Street, Sheffield S1 5EH', NULL, NULL, 'other', 'not_started', 'seller_solicitors', NULL, '5d062069-22db-4619-ab46-b51eff02b351', '2026-06-10 18:01:41.773239+00', '2026-06-10 18:01:41.773239+00'),
	('bc670543-59da-4390-8394-4d67d20b80e8', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'spa', 'Share Purchase Agreement', 'v1', NULL, 'other', 'issued', 'buyer_solicitors', '2026-06-12', NULL, '2026-06-10 18:01:41.773239+00', '2026-06-10 18:01:41.778817+00'),
	('8fd80c50-d255-4e1e-9492-ec2b462cd39a', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'ddq', 'Due Diligence Questionnaire', NULL, NULL, 'other', 'with_sellers', 'sellers', '2026-06-07', NULL, '2026-06-10 18:01:41.773239+00', '2026-06-10 18:01:41.78079+00');


--
-- Data for Name: document_status_history; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.document_status_history VALUES
	('74512d1f-8073-45bf-95c2-57a0df35571a', '59fe58ef-f4fb-406f-9fff-02905c5baeb2', NULL, 'signed', NULL, '2026-06-10 18:01:41.342859+00', NULL, '2026-06-10 18:01:41.342859+00'),
	('29f6472e-3a43-4234-947f-6c25249d7a38', '5a1193fb-243c-4271-8ba9-aa70a0942177', NULL, 'not_started', NULL, '2026-06-10 18:01:41.342859+00', NULL, '2026-06-10 18:01:41.342859+00'),
	('c3e66ca3-9116-45a0-a5a5-388464e7b5ed', 'd8411b1e-f45b-489e-a384-6e643c54cd5b', NULL, 'not_started', NULL, '2026-06-10 18:01:41.342859+00', NULL, '2026-06-10 18:01:41.342859+00'),
	('ebcbc747-2ab2-4be3-a2e2-04c739aca142', '71db3abd-f4c1-4a5f-aad6-955f3c00bf6e', NULL, 'not_started', NULL, '2026-06-10 18:01:41.342859+00', NULL, '2026-06-10 18:01:41.342859+00'),
	('0e10827e-1f40-49f2-ad0f-0d6cc7dcfd2e', '0889d2d6-b013-4bc5-9b09-13eeaa97b3b3', NULL, 'not_started', NULL, '2026-06-10 18:01:41.342859+00', NULL, '2026-06-10 18:01:41.342859+00'),
	('ca17ba92-0d69-4e29-8f06-23e703a9f981', 'b724c579-9093-4613-b867-d7e0be6581ec', NULL, 'not_started', NULL, '2026-06-10 18:01:41.342859+00', NULL, '2026-06-10 18:01:41.342859+00'),
	('597a51b3-aa8a-44c4-80f6-03bb5e05a6d8', '82129b64-aa71-4433-b53e-301df4c890ad', NULL, 'not_started', NULL, '2026-06-10 18:01:41.342859+00', NULL, '2026-06-10 18:01:41.342859+00'),
	('99c8cc4b-5e68-44ca-be3e-06837c91bb43', 'ef7f29ad-70dd-4249-81ea-8965914cfd8c', NULL, 'not_started', NULL, '2026-06-10 18:01:41.342859+00', NULL, '2026-06-10 18:01:41.342859+00'),
	('6fe91a25-00af-4a2c-812d-48466b0bbb83', 'd2c5ad27-3bc2-4b7e-b0d1-3bd5126aed1b', NULL, 'not_started', NULL, '2026-06-10 18:01:41.342859+00', NULL, '2026-06-10 18:01:41.342859+00'),
	('96bd0428-378f-4ea2-816f-b840ce1a7d73', '5a1193fb-243c-4271-8ba9-aa70a0942177', 'not_started', 'drafting', NULL, '2026-06-10 18:01:41.352961+00', NULL, '2026-06-10 18:01:41.352961+00'),
	('21aca810-4b2c-486c-a9c2-3dc09cfb2343', '5a1193fb-243c-4271-8ba9-aa70a0942177', 'drafting', 'issued', NULL, '2026-06-10 18:01:41.354899+00', NULL, '2026-06-10 18:01:41.354899+00'),
	('691a7fac-532b-4b37-b3ec-ac8a1c7780d2', '5a1193fb-243c-4271-8ba9-aa70a0942177', 'issued', 'with_sellers', NULL, '2026-06-10 18:01:41.356599+00', NULL, '2026-06-10 18:01:41.356599+00'),
	('bf4d3a57-8e17-4ce1-bb59-20d9a2661340', 'd8411b1e-f45b-489e-a384-6e643c54cd5b', 'not_started', 'drafting', NULL, '2026-06-10 18:01:41.358184+00', NULL, '2026-06-10 18:01:41.358184+00'),
	('1e4adaf4-4338-4486-b54d-8f1ac8fb88e8', '0889d2d6-b013-4bc5-9b09-13eeaa97b3b3', 'not_started', 'agreed', NULL, '2026-06-10 18:01:41.359682+00', NULL, '2026-06-10 18:01:41.359682+00'),
	('db87dc2e-958a-4e47-a5d5-ca3e89067b22', 'ef7f29ad-70dd-4249-81ea-8965914cfd8c', 'not_started', 'issued', NULL, '2026-06-10 18:01:41.361245+00', NULL, '2026-06-10 18:01:41.361245+00'),
	('ae342a78-2bec-4953-86db-9d41dc8c7299', 'd2c5ad27-3bc2-4b7e-b0d1-3bd5126aed1b', 'not_started', 'agreed', NULL, '2026-06-10 18:01:41.36315+00', NULL, '2026-06-10 18:01:41.36315+00'),
	('86e395d0-ff2e-43a4-ab85-20d104963b71', '82129b64-aa71-4433-b53e-301df4c890ad', 'not_started', 'drafting', NULL, '2026-06-10 18:01:41.364629+00', NULL, '2026-06-10 18:01:41.364629+00'),
	('da4a17fb-d48f-4bcf-93a5-b194beadde71', '6d6779a2-54d6-401d-83b2-b341e21d6e57', NULL, 'signed', NULL, '2026-06-10 18:01:41.773239+00', NULL, '2026-06-10 18:01:41.773239+00'),
	('c22fa280-7213-4521-beb3-05446ae34c55', 'bc670543-59da-4390-8394-4d67d20b80e8', NULL, 'not_started', NULL, '2026-06-10 18:01:41.773239+00', NULL, '2026-06-10 18:01:41.773239+00'),
	('dbbad42a-0bb6-4aa6-9469-58badd42157b', '675e6524-614c-4dd5-be97-f3b13b69a586', NULL, 'not_started', NULL, '2026-06-10 18:01:41.773239+00', NULL, '2026-06-10 18:01:41.773239+00'),
	('7dea5985-2c45-426f-aed5-a4d79a147988', '4d416e77-6bbe-469c-9f65-fedc3f028508', NULL, 'not_started', NULL, '2026-06-10 18:01:41.773239+00', NULL, '2026-06-10 18:01:41.773239+00'),
	('7d58054a-01fb-4e98-aab6-89512213b52e', '8fd80c50-d255-4e1e-9492-ec2b462cd39a', NULL, 'not_started', NULL, '2026-06-10 18:01:41.773239+00', NULL, '2026-06-10 18:01:41.773239+00'),
	('5c20e4fb-ab24-48e7-875b-15615614affc', '99352373-4002-4a00-b588-7442cd5e36aa', NULL, 'not_started', NULL, '2026-06-10 18:01:41.773239+00', NULL, '2026-06-10 18:01:41.773239+00'),
	('489291e6-d1d7-4614-a367-09b9988ff45a', '0eac282a-9b5a-40cf-a537-64e5a6de5ba9', NULL, 'not_started', NULL, '2026-06-10 18:01:41.773239+00', NULL, '2026-06-10 18:01:41.773239+00'),
	('b23e907d-4fcd-4f6a-8580-4926f2f8b60a', 'ae18d239-61e0-4655-9499-1971c45c103b', NULL, 'not_started', NULL, '2026-06-10 18:01:41.773239+00', NULL, '2026-06-10 18:01:41.773239+00'),
	('f31b45d7-3bc5-4a9a-8a42-81850cff50b4', 'bc670543-59da-4390-8394-4d67d20b80e8', 'not_started', 'issued', NULL, '2026-06-10 18:01:41.778817+00', NULL, '2026-06-10 18:01:41.778817+00'),
	('5d95430f-4ec2-4a09-9eb9-a224e44328e0', '8fd80c50-d255-4e1e-9492-ec2b462cd39a', 'not_started', 'with_sellers', NULL, '2026-06-10 18:01:41.78079+00', NULL, '2026-06-10 18:01:41.78079+00');


--
-- Data for Name: interactions; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.interactions VALUES
	('2636e65c-0e34-47ed-ba50-dc3234f2bb66', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'e474cddd-cea3-4874-b87c-b05d8618c7da', '2026-04-12', NULL, 'whatsapp_day', NULL, NULL, 'WhatsApp — 6 messages', 'Sarah: Quick one — does the earn-out survive if we sell Putney?
Oli: It adjusts pro-rata, schedule 3 covers it
Sarah: Perfect thanks
Oli: Call tomorrow to walk through?
Sarah: Yes 8.30 before clinic
Oli: Booked 👍', 'whatsapp_import', 'wa:905bb66e3a9c47e582066c4ff3f0a6e8e4298abaae5f745019410d234fc33bba', '2026-06-10 18:01:41.384176+00', '2026-06-10 18:01:41.384176+00'),
	('c8715b2b-7eff-4766-b532-11f69de0be7f', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'e474cddd-cea3-4874-b87c-b05d8618c7da', '2026-04-13', NULL, 'whatsapp_day', NULL, NULL, 'WhatsApp — 4 messages', 'Oli: Notes from this morning sent to Tom
Sarah: Seen — happy with the retention mechanics
Sarah: Mark wants the loan note coupon confirmed
Oli: 6% per the LOI, in the instrument draft', 'whatsapp_import', 'wa:3e4f34fe5ff5db7443a53e750fe23690e4bc7ad731cd5c5dde043b1e4d591706', '2026-06-10 18:01:41.38764+00', '2026-06-10 18:01:41.38764+00'),
	('6450d1e4-c388-4373-afc2-04e24d609085', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'e474cddd-cea3-4874-b87c-b05d8618c7da', '2026-04-15', NULL, 'whatsapp_day', NULL, NULL, 'WhatsApp — 9 messages', 'Sarah: Landlord''s agent came back on Putney consent
Oli: Good news?
Sarah: They want a rent deposit from the buyer entity
Oli: Standard ask — legal will handle
Sarah: Also they asked about works we did in 2019
Oli: Send me the licence for alterations if you have it
Sarah: Digging it out tonight
Oli: 🙏
Sarah: Found it, emailing now', 'whatsapp_import', 'wa:6781c487e4da1b3659327d008665b62bab481e8d88ee399a237b28f023796132', '2026-06-10 18:01:41.389137+00', '2026-06-10 18:01:41.389137+00'),
	('dfb5db4c-6fef-4b00-b3a8-605b6cd53124', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'e474cddd-cea3-4874-b87c-b05d8618c7da', '2025-12-16', '2025-12-16 11:00:00+00', 'meeting', 'outbound', NULL, 'Coffee at Richmond clinic — toured all 3 sites, met senior team', NULL, 'manual', NULL, '2026-06-10 18:01:41.390681+00', '2026-06-10 18:01:41.390681+00'),
	('9616c94b-878e-4970-b8d9-64d6fd193070', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '0c0aaf1d-eb2a-487f-9941-4504e578e82f', '2026-01-10', '2026-01-10 11:00:00+00', 'meeting', NULL, NULL, 'Dinner with Sarah & Mark — talked numbers, verbal range shared', NULL, 'manual', NULL, '2026-06-10 18:01:41.394435+00', '2026-06-10 18:01:41.394435+00'),
	('ad600b98-aa99-404b-b01f-469ed17963f9', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '0036af4e-4943-4d40-b47f-092d544d33ea', '2026-02-13', '2026-02-13 11:00:00+00', 'call', NULL, NULL, 'Process call with Tom Bryce — agreed LOI timeline and exclusivity ask', NULL, 'manual', NULL, '2026-06-10 18:01:41.395923+00', '2026-06-10 18:01:41.395923+00'),
	('10607717-2c03-4f1d-85a4-07b9f0d4969f', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '5450601a-0346-4fff-a46c-fc0c1a26dc90', '2026-05-01', '2026-05-01 11:00:00+00', 'call', NULL, NULL, 'Legal kickoff — Hartley Law walked through DDQ schedule and SPA timetable', NULL, 'manual', NULL, '2026-06-10 18:01:41.397738+00', '2026-06-10 18:01:41.397738+00'),
	('154b71c3-85ab-4252-9876-f9cd77f35e35', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', NULL, '2026-05-27', '2026-05-27 11:00:00+00', 'note', NULL, NULL, 'QoE final report in — EBITDA £405k holds, working capital peg agreed', NULL, 'manual', NULL, '2026-06-10 18:01:41.399067+00', '2026-06-10 18:01:41.399067+00'),
	('3c875ad1-b294-4f9f-9950-5fecc9fce0b6', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'e474cddd-cea3-4874-b87c-b05d8618c7da', '2026-06-07', '2026-06-07 11:00:00+00', 'call', NULL, NULL, 'Sarah pre-announcement plan call — staff comms on the 24th, aligned', NULL, 'manual', NULL, '2026-06-10 18:01:41.400388+00', '2026-06-10 18:01:41.400388+00'),
	('864acfb5-f826-416d-ad9f-46073ed54010', 'a6ed8ae6-278c-42aa-a755-89609dd587af', '63823073-08a2-431d-9236-0e7e95154311', '2026-05-29', '2026-05-29 11:00:00+00', 'email', 'inbound', NULL, 'Rollover option interest + Leith lease timing', NULL, 'manual', NULL, '2026-06-10 18:01:41.445402+00', '2026-06-10 18:01:41.445402+00'),
	('ae654bf5-4f42-4ea3-9942-2664e4a7d1c7', '4cd719b8-eddb-4486-8ce1-9d34a74729a4', 'ecc36381-4965-47ec-ae88-a8a2dcfd993d', '2026-05-19', '2026-05-19 11:00:00+00', 'meeting', NULL, NULL, 'First sit-down with Dee — open to sale, wants staff continuity guarantees', NULL, 'manual', NULL, '2026-06-10 18:01:41.461283+00', '2026-06-10 18:01:41.461283+00'),
	('b15f3078-01ab-45b8-8a88-dda87c11acb9', 'a45b01a2-cec5-4e1c-8306-e9d0a4b60077', 'f1fc9faa-cb1a-4fc4-bb0e-fb1d3898385c', '2026-05-21', '2026-05-21 11:00:00+00', 'call', NULL, NULL, 'Verbal range discussed with Karen — receptive, wants to talk to family', NULL, 'manual', NULL, '2026-06-10 18:01:41.474569+00', '2026-06-10 18:01:41.474569+00'),
	('4f54b18d-22f0-40d6-af16-32180d62bb45', '027f5758-2aa8-4232-bb83-cbd52d40e30e', '48a30366-459e-4268-8735-34d6fdc941d9', '2026-05-03', '2026-05-03 11:00:00+00', 'call', NULL, NULL, 'Intro call with Joe — happy to share accounts after summer', NULL, 'manual', NULL, '2026-06-10 18:01:41.483765+00', '2026-06-10 18:01:41.483765+00'),
	('e92a5fdc-3484-4f5a-b669-5c5c6cc4b105', '4231a51e-56d4-4957-937a-783ada5369fd', NULL, '2026-04-20', '2026-04-20 11:00:00+00', 'call', NULL, NULL, 'Desk note — strong Google reviews, NHS contract mix worth a look', NULL, 'manual', NULL, '2026-06-10 18:01:41.547315+00', '2026-06-10 18:01:41.547315+00'),
	('d7c713b4-b6e0-4771-b5b5-5c7882169bc6', '1e59e645-ba91-4434-9b42-05b356a17b97', NULL, '2026-05-28', '2026-05-28 11:00:00+00', 'note', NULL, NULL, 'Desk note — strong Google reviews, NHS contract mix worth a look', NULL, 'manual', NULL, '2026-06-10 18:01:41.555922+00', '2026-06-10 18:01:41.555922+00'),
	('cd8cd07b-2f30-44ee-be5d-54be4f5563b6', '3b2d2fa1-9ea6-42a2-ad8a-374a7ded2e50', NULL, '2026-05-05', '2026-05-05 11:00:00+00', 'call', NULL, NULL, 'Desk note — strong Google reviews, NHS contract mix worth a look', NULL, 'manual', NULL, '2026-06-10 18:01:41.563186+00', '2026-06-10 18:01:41.563186+00'),
	('96d2f0ec-5cb1-4568-bf2b-85c307714179', 'e177b41b-d749-4cd0-8e69-25b953dac288', NULL, '2026-04-15', '2026-04-15 11:00:00+00', 'call', NULL, NULL, 'Intro call — gauging appetite, owner curious about valuation', NULL, 'manual', NULL, '2026-06-10 18:01:41.571299+00', '2026-06-10 18:01:41.571299+00'),
	('88ebed31-9eb4-4dbe-bd9e-44a55ff8ff1f', '97d20fa2-de94-4e10-bb18-1a18bd3b5a04', NULL, '2026-06-08', '2026-06-08 11:00:00+00', 'call', NULL, NULL, 'Desk note — strong Google reviews, NHS contract mix worth a look', NULL, 'manual', NULL, '2026-06-10 18:01:41.578676+00', '2026-06-10 18:01:41.578676+00'),
	('0dc88d46-6e66-4574-932c-6a011ec60689', 'e51280ba-d3b2-46e6-b213-286cfbcd4079', NULL, '2026-06-05', '2026-06-05 11:00:00+00', 'call', NULL, NULL, 'Intro call — gauging appetite, owner curious about valuation', NULL, 'manual', NULL, '2026-06-10 18:01:41.594955+00', '2026-06-10 18:01:41.594955+00'),
	('35735488-31e4-4c22-a12a-107b6a9594a9', 'b11d9e25-d742-48eb-8454-5e654f9eb885', NULL, '2026-05-04', '2026-05-04 11:00:00+00', 'note', NULL, NULL, 'Desk note — strong Google reviews, NHS contract mix worth a look', NULL, 'manual', NULL, '2026-06-10 18:01:41.612402+00', '2026-06-10 18:01:41.612402+00'),
	('fe904a9f-f575-48ce-bf13-01014271fd83', 'bacc0c31-58db-455f-b5d9-4593df0f9759', NULL, '2026-06-01', '2026-06-01 11:00:00+00', 'note', NULL, NULL, 'Intro call — gauging appetite, owner curious about valuation', NULL, 'manual', NULL, '2026-06-10 18:01:41.622615+00', '2026-06-10 18:01:41.622615+00'),
	('78a7b613-020e-4c15-8ae3-92dd7e5aa73b', '2746e221-f436-47e0-b997-c67bce25f957', NULL, '2026-06-06', '2026-06-06 11:00:00+00', 'note', NULL, NULL, 'Desk note — strong Google reviews, NHS contract mix worth a look', NULL, 'manual', NULL, '2026-06-10 18:01:41.678837+00', '2026-06-10 18:01:41.678837+00'),
	('96296c84-30d7-4786-a3e1-955cf177770b', '82d233ce-5ede-4256-b351-16d8a7e438b0', NULL, '2026-06-08', '2026-06-08 11:00:00+00', 'note', NULL, NULL, 'Desk note — strong Google reviews, NHS contract mix worth a look', NULL, 'manual', NULL, '2026-06-10 18:01:41.698326+00', '2026-06-10 18:01:41.698326+00'),
	('2bc7ba05-0e0a-4203-9905-2f2c87bb0594', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', NULL, '2026-05-29', '2026-05-29 11:00:00+00', 'call', NULL, NULL, 'Desk note — strong Google reviews, NHS contract mix worth a look', NULL, 'manual', NULL, '2026-06-10 18:01:41.717133+00', '2026-06-10 18:01:41.717133+00'),
	('b0b4f57c-e927-4d4c-b7d4-0ad40053bcec', '0ff5c8a2-ba0e-4006-bc2c-2e12f0f00c3e', NULL, '2026-05-02', '2026-05-02 11:00:00+00', 'call', NULL, NULL, 'Desk note — strong Google reviews, NHS contract mix worth a look', NULL, 'manual', NULL, '2026-06-10 18:01:41.749955+00', '2026-06-10 18:01:41.749955+00'),
	('70baaa1e-a966-439f-9d0b-4a26149fe33e', '574f1475-a8db-41bf-8107-68538d42cff3', NULL, '2026-06-01', '2026-06-01 11:00:00+00', 'call', NULL, NULL, 'Intro call — gauging appetite, owner curious about valuation', NULL, 'manual', NULL, '2026-06-10 18:01:41.757623+00', '2026-06-10 18:01:41.757623+00'),
	('a44b684e-68e3-47cd-8c35-a46537b09fa7', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'e474cddd-cea3-4874-b87c-b05d8618c7da', '2025-12-10', '2025-12-10 10:14:00+00', 'email', 'outbound', 'Great to meet at Therapy Expo', 'Great to meet at Therapy Expo', 'Sarah — really enjoyed our chat at the NEC yesterday. As discussed, Kinetico is building a clinician-led group and Riverside is exactly the kind of practice we admire. Would you be open to a coffee in the next couple of weeks?', 'outlook_sync', 'fixture-msg-001', '2026-06-10 18:01:41.78471+00', '2026-06-10 18:01:41.78471+00'),
	('9a709e1b-ff46-42ac-bd4d-96bce3e13b9c', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'e474cddd-cea3-4874-b87c-b05d8618c7da', '2025-12-14', '2025-12-14 11:14:00+00', 'email', 'inbound', 'RE: Great to meet at Therapy Expo', 'RE: Great to meet at Therapy Expo', 'Hi Oli, likewise! Mark and I have been thinking about the next chapter for a while. Happy to meet — Thursdays are best at the Richmond clinic.', 'outlook_sync', 'fixture-msg-002', '2026-06-10 18:01:41.786621+00', '2026-06-10 18:01:41.786621+00'),
	('5dccb6cf-0bf2-4737-acad-3577de26a983', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'e474cddd-cea3-4874-b87c-b05d8618c7da', '2025-12-27', '2025-12-27 12:14:00+00', 'email', 'outbound', 'Following up — high-level numbers', 'Following up — high-level numbers', 'Thanks both for the tour on Thursday. To take this forward we''d need last two years'' accounts and a rough split of clinic revenue across Richmond, Kingston and Putney. Happy to sign an NDA first of course.', 'outlook_sync', 'fixture-msg-003', '2026-06-10 18:01:41.789332+00', '2026-06-10 18:01:41.789332+00'),
	('90148a44-0424-4099-a8ee-e754bb03cc48', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '0c0aaf1d-eb2a-487f-9941-4504e578e82f', '2026-01-01', '2026-01-01 13:14:00+00', 'email', 'inbound', 'RE: Following up — high-level numbers', 'RE: Following up — high-level numbers', 'NDA signed and attached. Headline: group did £1.62m last year across the three sites, EBITDA around £390k after our salaries. Detail to follow from our accountant.', 'outlook_sync', 'fixture-msg-004', '2026-06-10 18:01:41.790973+00', '2026-06-10 18:01:41.790973+00'),
	('3f5ec830-f803-48db-a35f-ff9ed5dfef2e', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '0c0aaf1d-eb2a-487f-9941-4504e578e82f', '2026-01-15', '2026-01-15 14:14:00+00', 'email', 'outbound', 'Indicative offer — Riverside Physio Group', 'Indicative offer — Riverside Physio Group', 'Mark, Sarah — following our call, please find attached our indicative offer letter: £2.1m enterprise value on a cash-free debt-free basis, 70% cash at completion and 30% loan notes over 3 years.', 'outlook_sync', 'fixture-msg-005', '2026-06-10 18:01:41.792629+00', '2026-06-10 18:01:41.792629+00'),
	('e2ae7a10-7da2-4a70-9fb6-7f862551e1a3', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'e474cddd-cea3-4874-b87c-b05d8618c7da', '2026-01-22', '2026-01-22 15:14:00+00', 'email', 'inbound', 'RE: Indicative offer — Riverside Physio Group', 'RE: Indicative offer — Riverside Physio Group', 'Oli — thank you, it''s a fair starting point. We''d like to talk about the earn-out element and what happens with the Putney lease renewal before we respond formally.', 'outlook_sync', 'fixture-msg-006', '2026-06-10 18:01:41.794353+00', '2026-06-10 18:01:41.794353+00'),
	('c226eadd-a3cb-424c-a1a0-2450c14db1d9', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '0036af4e-4943-4d40-b47f-092d544d33ea', '2026-02-04', '2026-02-04 16:14:00+00', 'email', 'inbound', 'Introducing myself — acting for Riverside', 'Introducing myself — acting for Riverside', 'Oli, I''m advising Sarah and Mark Whitfield on the potential sale of Riverside Physio Group. Could we set up a call this week to discuss process and timetable?', 'outlook_sync', 'fixture-msg-007', '2026-06-10 18:01:41.796046+00', '2026-06-10 18:01:41.796046+00'),
	('50c751ce-9e89-4e9a-8d6e-858f66af6cfb', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '0036af4e-4943-4d40-b47f-092d544d33ea', '2026-02-12', '2026-02-12 09:14:00+00', 'email', 'outbound', 'RE: Introducing myself — acting for Riverside', 'RE: Introducing myself — acting for Riverside', 'Welcome aboard Tom. Call booked for Thursday. Our revised LOI will reflect the updated EBITDA figure of £405k your team shared.', 'outlook_sync', 'fixture-msg-008', '2026-06-10 18:01:41.79824+00', '2026-06-10 18:01:41.79824+00'),
	('cabe900a-cf1d-420e-9f05-b0553b1cef49', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '0036af4e-4943-4d40-b47f-092d544d33ea', '2026-02-26', '2026-02-26 10:14:00+00', 'email', 'outbound', 'LOI — Riverside Physio Group', 'LOI — Riverside Physio Group', 'Tom — attached is our LOI: £2.25m EV (~5.5x), 70/30 cash/loan notes, plus a 2-year earn-out of up to £150k tied to revenue retention. We propose 8 weeks exclusivity.', 'outlook_sync', 'fixture-msg-009', '2026-06-10 18:01:41.800207+00', '2026-06-10 18:01:41.800207+00'),
	('15fc0403-b9ad-4de8-9cdb-d1c4a41c805c', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '0036af4e-4943-4d40-b47f-092d544d33ea', '2026-03-06', '2026-03-06 11:14:00+00', 'email', 'inbound', 'RE: LOI — Riverside Physio Group', 'RE: LOI — Riverside Physio Group', 'Oli — clients are minded to accept. Two asks: earn-out cap at £200k and exclusivity at 6 weeks. If agreeable we''ll countersign this week.', 'outlook_sync', 'fixture-msg-010', '2026-06-10 18:01:41.801788+00', '2026-06-10 18:01:41.801788+00'),
	('1b6e648b-ee02-4743-b702-aa522afa3237', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '0036af4e-4943-4d40-b47f-092d544d33ea', '2026-03-14', '2026-03-14 12:14:00+00', 'email', 'outbound', 'RE: LOI — agreed position', 'RE: LOI — agreed position', 'Agreed on both. Amended LOI attached for countersignature. Looking forward to getting into DD.', 'outlook_sync', 'fixture-msg-011', '2026-06-10 18:01:41.804552+00', '2026-06-10 18:01:41.804552+00'),
	('9a34be76-5ce8-41a0-ae35-142d0a17c56a', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '5450601a-0346-4fff-a46c-fc0c1a26dc90', '2026-03-28', '2026-03-28 13:14:00+00', 'email', 'inbound', 'Hartley Law instructed — Riverside / Project Thames', 'Hartley Law instructed — Riverside / Project Thames', 'Dear Oli, we are instructed by the sellers of Riverside Physio Group. Please direct legal correspondence to me. Our DDQ responses will follow by the end of next week.', 'outlook_sync', 'fixture-msg-012', '2026-06-10 18:01:41.806047+00', '2026-06-10 18:01:41.806047+00'),
	('b1703f85-f533-4a5f-9739-ebdd9f5b7bad', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '5450601a-0346-4fff-a46c-fc0c1a26dc90', '2026-04-11', '2026-04-11 14:14:00+00', 'email', 'inbound', 'DDQ responses + data room access', 'DDQ responses + data room access', 'DDQ responses uploaded to the data room. Note the Putney lease has a landlord consent requirement on change of control — flagged in section 7.', 'outlook_sync', 'fixture-msg-013', '2026-06-10 18:01:41.808028+00', '2026-06-10 18:01:41.808028+00'),
	('d6fd518e-7d15-4142-b44e-c00735c5f0e2', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '5450601a-0346-4fff-a46c-fc0c1a26dc90', '2026-04-30', '2026-04-30 15:14:00+00', 'email', 'outbound', 'Heads of Terms — execution copies', 'Heads of Terms — execution copies', 'Priya — HoTs signed by both sides today. Our solicitors will issue the first draft SPA within two weeks. Property: we''ll need the landlord consent process started on Putney now please.', 'outlook_sync', 'fixture-msg-014', '2026-06-10 18:01:41.809823+00', '2026-06-10 18:01:41.809823+00'),
	('0f8ca5fe-fe73-4684-a1a6-f2122cbda6d9', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '5450601a-0346-4fff-a46c-fc0c1a26dc90', '2026-05-21', '2026-05-21 16:14:00+00', 'email', 'inbound', 'SPA first draft — comments', 'SPA first draft — comments', 'Our markup of the SPA is attached. Main points: warranty cap, restrictive covenants duration, and the earn-out mechanics schedule.', 'outlook_sync', 'fixture-msg-015', '2026-06-10 18:01:41.812248+00', '2026-06-10 18:01:41.812248+00'),
	('3e4a194c-5c15-4275-ae49-7634b1c030cb', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', '5450601a-0346-4fff-a46c-fc0c1a26dc90', '2026-06-04', '2026-06-04 09:14:00+00', 'email', 'inbound', 'SPA v3 + loan note instrument', 'SPA v3 + loan note instrument', 'SPA v3 attached reflecting Friday''s call — now with sellers for review. First draft of the loan note instrument to follow from your side per the agreed split.', 'outlook_sync', 'fixture-msg-016', '2026-06-10 18:01:41.81413+00', '2026-06-10 18:01:41.81413+00'),
	('16288c78-7c33-47d1-b256-45307cae211a', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'e474cddd-cea3-4874-b87c-b05d8618c7da', '2026-06-08', '2026-06-08 10:14:00+00', 'email', 'inbound', 'Team announcement timing', 'Team announcement timing', 'Oli — once the SPA settles, can we agree the staff announcement plan? We''d like to tell the senior physios in person at the Richmond team day on the 24th.', 'outlook_sync', 'fixture-msg-017', '2026-06-10 18:01:41.815987+00', '2026-06-10 18:01:41.815987+00'),
	('b1910b18-bcef-4ff1-bfc8-32c0bd3d84dd', '18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', '549115ae-7bcd-4a4d-a2e7-34bfaf75b7c2', '2026-03-07', '2026-03-07 11:14:00+00', 'email', 'inbound', 'Accounts as requested', 'Accounts as requested', 'Oli, attached the FY23 and FY24 accounts plus practitioner utilisation split. EBITDA normalises to about £210k once you add back my locum cover.', 'outlook_sync', 'fixture-msg-018', '2026-06-10 18:01:41.817489+00', '2026-06-10 18:01:41.817489+00'),
	('96dbe6f1-8cc5-4aca-b16f-01243d19226e', '18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', '549115ae-7bcd-4a4d-a2e7-34bfaf75b7c2', '2026-04-13', '2026-04-13 12:14:00+00', 'email', 'outbound', 'Offer letter — Harborne Spine & Sport', 'Offer letter — Harborne Spine & Sport', 'Emma — formal offer attached: £1.05m EV, 70/30 structure, with a 12-month transition period for you at 2 days a week.', 'outlook_sync', 'fixture-msg-019', '2026-06-10 18:01:41.819156+00', '2026-06-10 18:01:41.819156+00'),
	('5261cd09-605e-47ef-a14d-addd42e15a95', '18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', '549115ae-7bcd-4a4d-a2e7-34bfaf75b7c2', '2026-05-08', '2026-05-08 13:14:00+00', 'email', 'inbound', 'RE: Offer letter — accepted in principle', 'RE: Offer letter — accepted in principle', 'Happy to proceed on that basis. My accountant will send the DD pack contents this week. CQC inspection report from January also attached.', 'outlook_sync', 'fixture-msg-020', '2026-06-10 18:01:41.821498+00', '2026-06-10 18:01:41.821498+00'),
	('6f72d4f6-b267-48e8-a859-d7856021ac87', '18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', '549115ae-7bcd-4a4d-a2e7-34bfaf75b7c2', '2026-06-01', '2026-06-01 14:14:00+00', 'email', 'inbound', 'DD queries — week 3 responses', 'DD queries — week 3 responses', 'Responses to the outstanding financial DD queries attached. Two employment contracts are still on old templates — our solicitor suggests a deed of variation pre-completion.', 'outlook_sync', 'fixture-msg-021', '2026-06-10 18:01:41.822979+00', '2026-06-10 18:01:41.822979+00'),
	('51956d5a-3efa-4cdb-9546-68c36438cdc0', 'a6ed8ae6-278c-42aa-a755-89609dd587af', '63823073-08a2-431d-9236-0e7e95154311', '2026-04-23', '2026-04-23 15:14:00+00', 'email', 'inbound', 'Caledonia — partnership structure question', 'Caledonia — partnership structure question', 'Oli, before we go further: two of our senior physios hold 10% each. Any acquisition would need to address their positions — how has Kinetico handled minority holders before?', 'outlook_sync', 'fixture-msg-022', '2026-06-10 18:01:41.824735+00', '2026-06-10 18:01:41.824735+00'),
	('4e6943a8-5010-4f14-af16-4e18d075967f', 'a6ed8ae6-278c-42aa-a755-89609dd587af', '63823073-08a2-431d-9236-0e7e95154311', '2026-05-14', '2026-05-14 16:14:00+00', 'email', 'outbound', 'RE: partnership structure question', 'RE: partnership structure question', 'Fraser — we''ve done this twice: minority holders either sell alongside on identical terms or roll into Kinetico group equity. Happy to walk through both models on a call.', 'outlook_sync', 'fixture-msg-023', '2026-06-10 18:01:41.826328+00', '2026-06-10 18:01:41.826328+00'),
	('e32f5c07-85c5-45b5-b684-46b61a9dde7a', 'a6ed8ae6-278c-42aa-a755-89609dd587af', '63823073-08a2-431d-9236-0e7e95154311', '2026-05-29', '2026-05-29 09:14:00+00', 'email', 'inbound', 'RE: partnership structure question', 'RE: partnership structure question', 'The rollover option is interesting. Can you send the group equity overview? Also our Leith lease renews in March — worth factoring into timing.', 'outlook_sync', 'fixture-msg-024', '2026-06-10 18:01:41.827916+00', '2026-06-10 18:01:41.827916+00');


--
-- Data for Name: legal_pack_templates; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.legal_pack_templates VALUES
	('4a1f8d8c-6a19-44ed-a1a5-63bb9e456b4b', 'hots', 1, 'signed', 'kinetico', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00'),
	('2035ec79-f5ce-49d2-8d20-cf89bca84ae3', 'spa', 2, 'not_started', 'buyer_solicitors', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00'),
	('8bca8e87-0461-49d7-8758-71d28cf1a6c7', 'loan_notes', 3, 'not_started', 'buyer_solicitors', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00'),
	('8bba2c15-bfb4-4d42-a283-22d061e841f5', 'earn_out', 4, 'not_started', 'buyer_solicitors', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00'),
	('6583771c-201e-466b-9e33-83cecd52996e', 'ddq', 5, 'not_started', 'sellers', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00'),
	('b9fd2260-18d9-4786-ac6f-6b44a6083e94', 'employment_contracts', 6, 'not_started', 'sellers', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00'),
	('eeebb714-8299-416c-bdf4-f22d64c4ad98', 'disclosure_letter', 7, 'not_started', 'seller_solicitors', '2026-06-10 18:01:40.748769+00', '2026-06-10 18:01:40.748769+00');


--
-- Data for Name: merge_log; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: offers; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.offers VALUES
	('f905f225-622b-4b4f-80aa-6404ac476c01', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'verbal', '2026-01-11', 2000000, 390000, DEFAULT, 70, 30, NULL, 'Ballpark shared over dinner after site tour — warm reception.', 'superseded', '2026-06-10 18:01:41.380765+00', '2026-06-10 18:01:41.380765+00'),
	('b4f7b551-03d8-407f-bea6-0cacfdf91c37', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'ioi', '2026-01-15', 2100000, 390000, DEFAULT, 70, 30, NULL, 'Indicative offer letter issued; CFDF basis.', 'superseded', '2026-06-10 18:01:41.380765+00', '2026-06-10 18:01:41.380765+00'),
	('78f4e94c-3dfd-45b6-9388-35c63168e84b', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'loi', '2026-02-26', 2250000, 405000, DEFAULT, 70, 30, 'Up to £200k over 2 years tied to revenue retention (cap raised from £150k).', '6 weeks exclusivity agreed; updated EBITDA basis from Bryce CF.', 'accepted', '2026-06-10 18:01:41.380765+00', '2026-06-10 18:01:41.380765+00'),
	('4411ca8b-57df-4ec8-b35b-66a968567515', '18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', 'loi', '2026-04-13', 1050000, 210000, DEFAULT, 70, 30, NULL, '12-month transition, 2 days/week clinical.', 'accepted', '2026-06-10 18:01:41.432221+00', '2026-06-10 18:01:41.432221+00'),
	('cfc7cc21-bb84-4d90-88ce-26d4bb6cc4b5', 'a45b01a2-cec5-4e1c-8306-e9d0a4b60077', 'verbal', '2026-05-21', 520000, 110000, DEFAULT, 70, 30, NULL, NULL, 'made', '2026-06-10 18:01:41.472427+00', '2026-06-10 18:01:41.472427+00'),
	('3c2ff432-d90c-49c7-942f-25259d71b026', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'loi', '2026-03-27', 900000, 180000, DEFAULT, 70, 30, NULL, NULL, 'accepted', '2026-06-10 18:01:41.782695+00', '2026-06-10 18:01:41.782695+00');


--
-- Data for Name: saved_views; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.saved_views VALUES
	('37f23a8a-8533-4b94-9def-7cfef847439a', '54786622-76b3-4642-aeef-d73aaba847c8', 'pipeline', 'Platinum & beyond', '{"owner": "all", "tiers": ["platinum"]}', '2026-06-10 18:01:41.838789+00', '2026-06-10 18:01:41.838789+00');


--
-- Data for Name: stage_history; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.stage_history VALUES
	('0a0d343a-cc64-47a6-ab2f-6d1e7719a0ca', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2025-12-10 10:30:00+00', '2026-06-10 18:01:41.304898+00'),
	('1135517b-79f3-44f0-b595-5a3542ad1585', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'identified', 'gold', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-01-11 10:30:00+00', '2026-06-10 18:01:41.317746+00'),
	('79a9db68-a3ad-44fb-a69d-d62f371b4938', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'gold', 'active_discussions', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-02-10 10:30:00+00', '2026-06-10 18:01:41.319894+00'),
	('e8674a16-69dd-4432-85f8-420b8c45a738', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'active_discussions', 'due_diligence', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-04-01 10:30:00+00', '2026-06-10 18:01:41.322656+00'),
	('205bdd0f-16f8-48b3-882a-6df9f83db34a', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'due_diligence', 'hots', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-04-30 10:30:00+00', '2026-06-10 18:01:41.326887+00'),
	('3151e04e-82d2-457d-82a6-db531b23309e', '18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-01-11 10:30:00+00', '2026-06-10 18:01:41.407816+00'),
	('08bb354b-77a8-4b5c-a797-ea8d714e6e72', '18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', 'identified', 'gold', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-02-10 10:30:00+00', '2026-06-10 18:01:41.413396+00'),
	('eb300c52-8782-4493-badb-725df1fbfd76', '18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', 'gold', 'active_discussions', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-03-22 10:30:00+00', '2026-06-10 18:01:41.415173+00'),
	('061fa27f-d1bd-472a-93c6-0e0b711d800c', '18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', 'active_discussions', 'due_diligence', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-05-11 10:30:00+00', '2026-06-10 18:01:41.417182+00'),
	('5704736c-2468-41f9-a075-b2c2d58fb7f2', 'a6ed8ae6-278c-42aa-a755-89609dd587af', NULL, 'identified', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-03-12 10:30:00+00', '2026-06-10 18:01:41.435723+00'),
	('54f9f573-eccb-4a27-b5eb-cd259c07cb46', 'a6ed8ae6-278c-42aa-a755-89609dd587af', 'identified', 'active_discussions', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-04-23 10:30:00+00', '2026-06-10 18:01:41.439467+00'),
	('8e266a9e-0b2d-4a05-a89c-9ae04b217e9f', '4cd719b8-eddb-4486-8ce1-9d34a74729a4', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-03-02 10:30:00+00', '2026-06-10 18:01:41.446748+00'),
	('0fd4656f-7949-4061-8cd6-6baa293114da', '4cd719b8-eddb-4486-8ce1-9d34a74729a4', 'identified', 'silver', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-04-01 10:30:00+00', '2026-06-10 18:01:41.452033+00'),
	('738e439c-b265-4fbd-bb72-da3342a353d2', '4cd719b8-eddb-4486-8ce1-9d34a74729a4', 'silver', 'active_discussions', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-05-06 10:30:00+00', '2026-06-10 18:01:41.453744+00'),
	('4f015be0-8f71-4cf0-bd39-3bb0a70a0629', 'a45b01a2-cec5-4e1c-8306-e9d0a4b60077', NULL, 'identified', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-03-22 10:30:00+00', '2026-06-10 18:01:41.462816+00'),
	('28307178-e31e-4ecb-b745-6890465ae29a', 'a45b01a2-cec5-4e1c-8306-e9d0a4b60077', 'identified', 'platinum', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-04-16 10:30:00+00', '2026-06-10 18:01:41.467519+00'),
	('a158bd46-4245-4c1e-a2ba-196bb25d0430', '027f5758-2aa8-4232-bb83-cbd52d40e30e', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-03-27 10:30:00+00', '2026-06-10 18:01:41.475879+00'),
	('15da4525-13f4-4223-b601-64b2744ecd8f', '027f5758-2aa8-4232-bb83-cbd52d40e30e', 'identified', 'gold', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-04-21 10:30:00+00', '2026-06-10 18:01:41.479182+00'),
	('e9fa7ab7-47e6-4ec1-a369-acbec7a8d92d', '67536aed-097d-4f18-9f85-5392db23ccca', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2025-08-14 10:30:00+00', '2026-06-10 18:01:41.485188+00'),
	('a0fbfd7d-3be2-4eef-9699-9775fb944668', '67536aed-097d-4f18-9f85-5392db23ccca', 'identified', 'gold', '54786622-76b3-4642-aeef-d73aaba847c8', '2025-10-03 10:30:00+00', '2026-06-10 18:01:41.489718+00'),
	('38e25cd7-be86-41f2-b2db-10ca4be06f8a', '67536aed-097d-4f18-9f85-5392db23ccca', 'gold', 'active_discussions', '54786622-76b3-4642-aeef-d73aaba847c8', '2025-11-22 10:30:00+00', '2026-06-10 18:01:41.491902+00'),
	('a067677a-e31d-49f8-9a96-c3d814a630aa', '67536aed-097d-4f18-9f85-5392db23ccca', 'active_discussions', 'due_diligence', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-01-01 10:30:00+00', '2026-06-10 18:01:41.493077+00'),
	('20245cba-f186-4322-a694-dddfa4c482c3', '67536aed-097d-4f18-9f85-5392db23ccca', 'due_diligence', 'hots', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-01-31 10:30:00+00', '2026-06-10 18:01:41.49732+00'),
	('0762ba79-c883-44b8-a22e-5619eb7b3b1c', '67536aed-097d-4f18-9f85-5392db23ccca', 'hots', 'complete', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-03-02 10:30:00+00', '2026-06-10 18:01:41.498962+00'),
	('cbc09c6a-03f1-424a-9590-8ed52398e095', '1b6bc658-ec5d-4bde-bcd4-604db6721e8a', NULL, 'identified', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2025-11-22 10:30:00+00', '2026-06-10 18:01:41.510088+00'),
	('be90bddc-b166-4174-af76-836550e968b5', '1b6bc658-ec5d-4bde-bcd4-604db6721e8a', 'identified', 'active_discussions', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-01-11 10:30:00+00', '2026-06-10 18:01:41.512848+00'),
	('02ccf8b0-c58e-48fa-adbf-7b7df1c10117', '1b6bc658-ec5d-4bde-bcd4-604db6721e8a', 'active_discussions', 'dead', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-03-12 10:30:00+00', '2026-06-10 18:01:41.51538+00'),
	('e466f966-6063-49b3-b2c9-610c99560f8b', '1161e808-2817-4f47-8b14-d9c8863dcba1', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2025-12-12 10:30:00+00', '2026-06-10 18:01:41.52049+00'),
	('13ce5c90-6c93-4b5b-83de-68e5925833bb', '1161e808-2817-4f47-8b14-d9c8863dcba1', 'identified', 'active_discussions', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-02-10 10:30:00+00', '2026-06-10 18:01:41.522914+00'),
	('8ab390e4-8281-40b8-9594-3484f6fd16c1', '1161e808-2817-4f47-8b14-d9c8863dcba1', 'active_discussions', 'reengage', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-04-11 10:30:00+00', '2026-06-10 18:01:41.524164+00'),
	('02f74d73-d932-4d00-8a92-a920077f4264', '2cd37272-e23d-4934-9cff-432c8573f33f', NULL, 'identified', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-04-11 10:30:00+00', '2026-06-10 18:01:41.533758+00'),
	('dd2187c4-343b-40b7-8778-96be99224d58', '2cd37272-e23d-4934-9cff-432c8573f33f', 'identified', 'silver', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-05-01 10:30:00+00', '2026-06-10 18:01:41.536567+00'),
	('fbefb51b-8582-4e70-887f-b223d79af760', '4231a51e-56d4-4957-937a-783ada5369fd', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-05-16 10:30:00+00', '2026-06-10 18:01:41.541283+00'),
	('01c7c84a-24a7-4a49-868b-75d15c2b8b46', '1e59e645-ba91-4434-9b42-05b356a17b97', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-05-23 10:30:00+00', '2026-06-10 18:01:41.550968+00'),
	('5e3ce8fb-90f3-4269-b009-85470b8161e0', '3b2d2fa1-9ea6-42a2-ad8a-374a7ded2e50', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-04-26 10:30:00+00', '2026-06-10 18:01:41.557087+00'),
	('33228570-e014-4146-9837-4b7eac9aabf3', 'e177b41b-d749-4cd0-8e69-25b953dac288', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-05-29 10:30:00+00', '2026-06-10 18:01:41.564711+00'),
	('5601423d-3d90-43ef-90e8-ac83e18dad9d', '97d20fa2-de94-4e10-bb18-1a18bd3b5a04', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-04-01 10:30:00+00', '2026-06-10 18:01:41.573571+00'),
	('7d0c796a-84af-4547-a4a3-de43c8e6c3a0', 'd1e5a6c0-d634-4c64-a2d7-32bb0ef42834', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-06-01 10:30:00+00', '2026-06-10 18:01:41.580185+00'),
	('0507f3e5-2dfd-4774-a94e-5a7697b5c9ca', 'e51280ba-d3b2-46e6-b213-286cfbcd4079', NULL, 'identified', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-04-16 10:30:00+00', '2026-06-10 18:01:41.584607+00'),
	('92b6c1d1-da98-4333-967d-6c819924dcbf', 'e51280ba-d3b2-46e6-b213-286cfbcd4079', 'identified', 'silver', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-05-11 10:30:00+00', '2026-06-10 18:01:41.589479+00'),
	('8fe9821c-9ca3-4ffb-8672-b11d59930850', 'c4655cb1-a961-4e53-b532-be7aa623c880', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-04-06 10:30:00+00', '2026-06-10 18:01:41.596737+00'),
	('e1883d66-105b-4493-ace3-064104e164af', 'c4655cb1-a961-4e53-b532-be7aa623c880', 'identified', 'silver', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-04-29 10:30:00+00', '2026-06-10 18:01:41.599393+00'),
	('262fc138-e93c-4279-ba95-fda569edf04f', 'b11d9e25-d742-48eb-8454-5e654f9eb885', NULL, 'identified', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-05-06 10:30:00+00', '2026-06-10 18:01:41.605077+00'),
	('44f109e9-ec5c-424d-a0df-b0115bdd9d77', 'b11d9e25-d742-48eb-8454-5e654f9eb885', 'identified', 'silver', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-05-26 10:30:00+00', '2026-06-10 18:01:41.608357+00'),
	('1a3a72fc-f8da-4990-8c85-328555310d76', 'bacc0c31-58db-455f-b5d9-4593df0f9759', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-03-07 10:30:00+00', '2026-06-10 18:01:41.613578+00'),
	('07289ab5-d6f6-485a-b6d7-0a725372c0c7', 'bacc0c31-58db-455f-b5d9-4593df0f9759', 'identified', 'gold', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-04-11 10:30:00+00', '2026-06-10 18:01:41.616429+00'),
	('93a2034e-e765-440e-8cf4-e44cd3d67241', '2f22d772-2b22-4223-9535-ab36ac19fe98', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-03-17 10:30:00+00', '2026-06-10 18:01:41.623786+00'),
	('486fb8a3-7799-4e0e-afe5-0e2b2c272793', '2f22d772-2b22-4223-9535-ab36ac19fe98', 'identified', 'silver', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-04-11 10:30:00+00', '2026-06-10 18:01:41.629552+00'),
	('057c76ce-6888-4bd6-bb6b-849c0e7fd5f3', '2f22d772-2b22-4223-9535-ab36ac19fe98', 'silver', 'gold', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-05-13 10:30:00+00', '2026-06-10 18:01:41.631189+00'),
	('78de4553-11e7-4662-99de-c018b88dc411', 'efa99ffc-a38b-4555-85e0-8928f3280c51', NULL, 'identified', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-04-21 10:30:00+00', '2026-06-10 18:01:41.637114+00');
INSERT INTO public.stage_history VALUES
	('1f9f961d-c3f4-4be5-a197-55f877832133', 'efa99ffc-a38b-4555-85e0-8928f3280c51', 'identified', 'gold', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-05-20 10:30:00+00', '2026-06-10 18:01:41.641358+00'),
	('e76e13e0-819b-4598-85f5-d0d066edb184', 'e97c5c08-5084-4fae-a306-b0a03f1e58ab', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-02-20 10:30:00+00', '2026-06-10 18:01:41.645846+00'),
	('761e5131-b295-491d-a911-0691c5d101e6', 'e97c5c08-5084-4fae-a306-b0a03f1e58ab', 'identified', 'gold', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-03-22 10:30:00+00', '2026-06-10 18:01:41.648561+00'),
	('a98596cf-3785-4b36-99f6-c15a85f9853c', 'e97c5c08-5084-4fae-a306-b0a03f1e58ab', 'gold', 'platinum', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-05-01 10:30:00+00', '2026-06-10 18:01:41.650147+00'),
	('2ca674ae-7ba4-4966-971f-c0c07bb5c8fc', '23d5223a-8949-404b-9aca-783e14eae49c', NULL, 'identified', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-03-12 10:30:00+00', '2026-06-10 18:01:41.656759+00'),
	('4d85d71d-bfd0-4f3b-870e-a11580f25947', '23d5223a-8949-404b-9aca-783e14eae49c', 'identified', 'platinum', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-05-08 10:30:00+00', '2026-06-10 18:01:41.660126+00'),
	('3ad197fa-527e-4593-bb49-15f9a81e4afd', '2746e221-f436-47e0-b997-c67bce25f957', NULL, 'identified', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-03-27 10:30:00+00', '2026-06-10 18:01:41.664908+00'),
	('5541e81a-b53f-4d34-acc9-4600fc700046', '2746e221-f436-47e0-b997-c67bce25f957', 'identified', 'silver', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-04-16 10:30:00+00', '2026-06-10 18:01:41.667748+00'),
	('0fef6d60-6d3b-4520-b157-b33d26fd1844', '2746e221-f436-47e0-b997-c67bce25f957', 'silver', 'active_discussions', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-05-15 10:30:00+00', '2026-06-10 18:01:41.669412+00'),
	('6fc4813e-4deb-4359-9e04-ea8ae61b6dda', '82d233ce-5ede-4256-b351-16d8a7e438b0', NULL, 'identified', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-01-31 10:30:00+00', '2026-06-10 18:01:41.680095+00'),
	('c7109411-bd3d-4ae6-8069-36058008c949', '82d233ce-5ede-4256-b351-16d8a7e438b0', 'identified', 'gold', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-03-02 10:30:00+00', '2026-06-10 18:01:41.682674+00'),
	('9ab35103-65f1-4b65-9251-a9869f835cd9', '82d233ce-5ede-4256-b351-16d8a7e438b0', 'gold', 'active_discussions', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-04-01 10:30:00+00', '2026-06-10 18:01:41.684124+00'),
	('8c8d0893-23e1-4b39-94ea-8cd255db3719', '82d233ce-5ede-4256-b351-16d8a7e438b0', 'active_discussions', 'due_diligence', '19fca03c-771e-4ac8-ba7d-2108e7c73832', '2026-05-20 10:30:00+00', '2026-06-10 18:01:41.685648+00'),
	('88aae11e-4c6c-4867-9c71-c54f7a4eea0f', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-01-01 10:30:00+00', '2026-06-10 18:01:41.699767+00'),
	('a65a983c-6c14-45bb-8f9c-2e0511c3379d', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'identified', 'active_discussions', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-03-02 10:30:00+00', '2026-06-10 18:01:41.702479+00'),
	('cbdc9dfe-a410-4643-83ad-84045613d1fb', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'active_discussions', 'due_diligence', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-04-01 10:30:00+00', '2026-06-10 18:01:41.705752+00'),
	('d08095e6-73b6-40d7-bd43-11af1ee911f6', '1b0c7e07-a212-44e2-a4df-bc8b0c3680b9', 'due_diligence', 'hots', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-05-16 10:30:00+00', '2026-06-10 18:01:41.707953+00'),
	('5f8fa274-149f-4c80-a7d7-802146ae62b0', 'b5ee0215-3bb8-46a8-8e17-6ca38059de64', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2025-07-25 10:30:00+00', '2026-06-10 18:01:41.720224+00'),
	('99835bd0-cee9-4246-a3e7-e60314ffe89d', 'b5ee0215-3bb8-46a8-8e17-6ca38059de64', 'identified', 'active_discussions', '54786622-76b3-4642-aeef-d73aaba847c8', '2025-09-23 10:30:00+00', '2026-06-10 18:01:41.723333+00'),
	('a6985661-4f44-4b86-8d5f-9b975c41532b', 'b5ee0215-3bb8-46a8-8e17-6ca38059de64', 'active_discussions', 'due_diligence', '54786622-76b3-4642-aeef-d73aaba847c8', '2025-11-02 10:30:00+00', '2026-06-10 18:01:41.724562+00'),
	('4c7e5ca7-9153-446f-9490-72ea08193fbf', 'b5ee0215-3bb8-46a8-8e17-6ca38059de64', 'due_diligence', 'hots', '54786622-76b3-4642-aeef-d73aaba847c8', '2025-12-02 10:30:00+00', '2026-06-10 18:01:41.726496+00'),
	('2f6bbf9e-c733-482c-95f9-a7674b221a5b', 'b5ee0215-3bb8-46a8-8e17-6ca38059de64', 'hots', 'complete', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-01-11 10:30:00+00', '2026-06-10 18:01:41.729023+00'),
	('29a50142-3ec6-4ab6-bcd7-268727361082', '0ff5c8a2-ba0e-4006-bc2c-2e12f0f00c3e', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-01-21 10:30:00+00', '2026-06-10 18:01:41.736866+00'),
	('a4f878f7-c0fc-438b-bc7c-ad9707646b2e', '0ff5c8a2-ba0e-4006-bc2c-2e12f0f00c3e', 'identified', 'active_discussions', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-03-12 10:30:00+00', '2026-06-10 18:01:41.739729+00'),
	('dc608b3b-6569-4ef2-b5b6-84020b33fdf8', '0ff5c8a2-ba0e-4006-bc2c-2e12f0f00c3e', 'active_discussions', 'reengage', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-04-21 10:30:00+00', '2026-06-10 18:01:41.743676+00'),
	('e661b33e-a6c8-43a9-a2cf-5033d0d4e4ce', '574f1475-a8db-41bf-8107-68538d42cff3', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-02-10 10:30:00+00', '2026-06-10 18:01:41.751087+00'),
	('3e26a46b-e895-412e-a521-8544fa074e9a', '574f1475-a8db-41bf-8107-68538d42cff3', 'identified', 'reengage', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-04-26 10:30:00+00', '2026-06-10 18:01:41.753661+00'),
	('3b6f5c52-114f-42c4-aab9-4bfd9a7e7f75', '447cc1b1-1552-4f46-ab4b-b30c46701347', NULL, 'identified', '54786622-76b3-4642-aeef-d73aaba847c8', '2025-10-13 10:30:00+00', '2026-06-10 18:01:41.760828+00'),
	('82b0c6a2-d263-4a61-93ae-d1599a8f712b', '447cc1b1-1552-4f46-ab4b-b30c46701347', 'identified', 'gold', '54786622-76b3-4642-aeef-d73aaba847c8', '2025-11-22 10:30:00+00', '2026-06-10 18:01:41.76386+00'),
	('b3923cfb-0d5c-4f52-a77e-9cf19d43f8f5', '447cc1b1-1552-4f46-ab4b-b30c46701347', 'gold', 'dead', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-01-01 10:30:00+00', '2026-06-10 18:01:41.765407+00');


--
-- Data for Name: sync_runs; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.sync_runs VALUES
	('6cca8e39-fadb-4b2c-88f3-18ea4d831af8', 'clinic_import', '2026-05-11 08:00:00+00', '2026-05-11 08:01:00+00', 'success', '{"skipped": 0, "written": 80, "records_in": 80}', NULL, '2026-06-10 18:01:41.834905+00', '2026-06-10 18:01:41.834905+00'),
	('cdc43566-d3b6-40cb-8f56-cbd323ce7203', 'outlook', '2026-06-09 07:30:00+00', '2026-06-09 07:31:00+00', 'success', '{"written": 24, "unmatched": 0, "provider_delta": 24, "matched_by_alias": 3, "matched_by_address": 21}', NULL, '2026-06-10 18:01:41.834905+00', '2026-06-10 18:01:41.834905+00'),
	('be1f5f04-8644-4b62-939e-a51bc2030109', 'companies_house', '2026-06-04 06:00:00+00', '2026-06-04 06:02:00+00', 'success', '{"clinics_checked": 12, "signals_created": 2}', NULL, '2026-06-10 18:01:41.834905+00', '2026-06-10 18:01:41.834905+00');


--
-- Data for Name: tasks; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.tasks VALUES
	('e7bdb081-0bff-4f3e-a9e7-f2c2cfa6aefc', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'Chase landlord consent — Putney lease', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-06-17', 'open', NULL, '2026-06-10 18:01:41.40172+00', '2026-06-10 18:01:41.40172+00'),
	('d1ae6bf0-8a42-4a1f-a219-8a4b4aef6eed', '6fcddeee-03dc-4aa9-9e55-045cf9afc762', 'Instruct loan note instrument first draft', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-06-15', 'open', NULL, '2026-06-10 18:01:41.40172+00', '2026-06-10 18:01:41.40172+00'),
	('aa39552a-ee06-4c5f-a1ef-cd62ac28cd38', '18a0eec8-70a5-4fa1-bdfd-db0ed1539fb1', 'Book QoE kickoff with Forsters', '54786622-76b3-4642-aeef-d73aaba847c8', '2026-06-14', 'open', NULL, '2026-06-10 18:01:41.433922+00', '2026-06-10 18:01:41.433922+00');


--
-- Data for Name: unmatched_emails; Type: TABLE DATA; Schema: public; Owner: -
--



--
-- Data for Name: user_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.user_profiles VALUES
	('54786622-76b3-4642-aeef-d73aaba847c8', 'Oli (Director of M&A)', 'admin', '2026-06-10 18:01:40.825574+00', '2026-06-10 18:01:40.825574+00'),
	('19fca03c-771e-4ac8-ba7d-2108e7c73832', 'Dan Mercer', 'deal_lead', '2026-06-10 18:01:40.835+00', '2026-06-10 18:01:40.835+00'),
	('4317c135-902c-484e-8527-f4e0846df578', 'Claire Voss', 'exec', '2026-06-10 18:01:40.841061+00', '2026-06-10 18:01:40.841061+00'),
	('9949d473-c565-45b2-94f7-982765c53ec5', 'Priti Rao', 'viewer', '2026-06-10 18:01:40.847089+00', '2026-06-10 18:01:40.847089+00');


--
-- PostgreSQL database dump complete
--



set session_replication_role = default;

-- 5 ── grants + verification --------------------------------------------------
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

select
  (select count(*) from public.clinics)      as clinics,   -- expect 80
  (select count(*) from public.deals)        as deals,     -- expect 31
  (select count(*) from public.interactions) as interactions,
  (select count(*) from public.documents)    as documents, -- expect 17
  (select count(*) from auth.users where email like '%kinetico.test') as demo_users; -- expect 4
