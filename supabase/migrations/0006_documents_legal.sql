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
