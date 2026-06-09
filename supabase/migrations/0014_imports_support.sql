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
