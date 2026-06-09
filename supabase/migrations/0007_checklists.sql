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
