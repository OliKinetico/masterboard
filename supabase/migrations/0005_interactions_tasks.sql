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
