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
