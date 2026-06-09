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
