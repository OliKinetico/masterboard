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
