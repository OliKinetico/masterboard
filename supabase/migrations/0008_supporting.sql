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
