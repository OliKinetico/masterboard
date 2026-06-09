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
