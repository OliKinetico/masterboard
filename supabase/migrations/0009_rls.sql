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
