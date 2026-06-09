/**
 * Row shapes as returned by Supabase (numeric → string, enums → unions).
 * Hand-maintained against /supabase/migrations — regenerate-by-hand when the
 * schema changes. Money/numeric columns arrive as strings and must be
 * formatted via src/lib/format.ts.
 */
import type {
  PipelineColumn,
  Tier,
  ContactRole,
  InteractionType,
  DocStatus,
  DocType,
  DocLocation,
  Responsible,
  OfferType,
  OfferStatus,
  ChangeOfControl,
  ChecklistItemStatus,
  UserRole,
} from "./domain";

export interface UserProfile {
  user_id: string;
  full_name: string;
  role: UserRole;
}

export interface Clinic {
  id: string;
  name: string;
  trading_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postcode: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  companies_house_number: string | null;
  website: string | null;
  phone: string | null;
  disciplines: string[];
  revenue_estimate: string | null;
  practitioner_count: number | null;
  sites_count: number;
  score: string | null;
  source: "platform_import" | "pipedrive_import" | "manual";
  platform_clinic_id: string | null;
  ch_last_accounts_date: string | null;
  merged_into_clinic_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  clinic_id: string | null;
  full_name: string;
  role: ContactRole;
  emails: string[];
  phone: string | null;
  whatsapp_number: string | null;
  notes: string | null;
  merged_into_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Deal {
  id: string;
  primary_clinic_id: string;
  name: string;
  pipeline_column: PipelineColumn;
  tier: Tier | null;
  is_live: boolean;
  first_met_on: string | null;
  first_met_context: string | null;
  owner_user_id: string | null;
  next_action: string | null;
  next_action_due: string | null;
  hots_signed_at: string | null;
  reengage_on: string | null;
  dead_reason: string | null;
  key_info: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface StageHistory {
  id: string;
  deal_id: string;
  from_column: PipelineColumn | null;
  to_column: PipelineColumn;
  moved_by: string | null;
  moved_at: string;
}

export interface Offer {
  id: string;
  deal_id: string;
  offer_type: OfferType;
  made_on: string;
  enterprise_value: string | null;
  ebitda_basis: string | null;
  implied_multiple: string | null;
  cash_pct: string;
  loan_note_pct: string;
  earn_out_summary: string | null;
  structure_notes: string | null;
  status: OfferStatus;
  created_at: string;
}

export interface Property {
  id: string;
  deal_id: string;
  clinic_id: string | null;
  address: string;
  leasehold: boolean;
  rent_pa: string | null;
  lease_start: string | null;
  lease_expiry: string | null;
  break_date: string | null;
  lease_length_years: string | null;
  change_of_control: ChangeOfControl;
  registration_required: boolean;
  landlord_name: string | null;
  notes: string | null;
}

export interface Interaction {
  id: string;
  deal_id: string;
  contact_id: string | null;
  occurred_on: string;
  occurred_at: string | null;
  type: InteractionType;
  direction: "inbound" | "outbound" | null;
  subject: string | null;
  summary: string;
  body: string | null;
  source: "manual" | "outlook_sync" | "whatsapp_import" | "pipedrive_migration";
  source_ref: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  deal_id: string;
  doc_type: DocType;
  title: string;
  version_label: string | null;
  url: string | null;
  location_hint: DocLocation;
  status: DocStatus;
  responsible: Responsible;
  due_on: string | null;
  property_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentStatusHistory {
  id: string;
  document_id: string;
  from_status: DocStatus | null;
  to_status: DocStatus;
  changed_by: string | null;
  changed_at: string;
  note: string | null;
}

export interface DealChecklist {
  id: string;
  deal_id: string;
  template_id: string | null;
  name: string;
}

export interface DealChecklistItem {
  id: string;
  checklist_id: string;
  title: string;
  sort: number;
  status: ChecklistItemStatus;
  responsible: Responsible;
  due_on: string | null;
  note: string | null;
}

export interface Task {
  id: string;
  deal_id: string;
  title: string;
  owner_user_id: string | null;
  due_on: string | null;
  status: "open" | "done";
  created_from_interaction_id: string | null;
  created_at: string;
}

export interface Comment {
  id: string;
  deal_id: string;
  author_user_id: string;
  body: string;
  created_at: string;
}

export interface SyncRun {
  id: string;
  source: "outlook" | "pipedrive" | "clinic_import" | "companies_house";
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "warning" | "error";
  counts: Record<string, unknown>;
  error: string | null;
}

export interface ChSignal {
  id: string;
  clinic_id: string;
  signal_type: "accounts_filed" | "director_change" | "other";
  detail: Record<string, unknown>;
  seen_on: string;
  acknowledged: boolean;
}

export interface ColumnSetting {
  pipeline_column: PipelineColumn;
  probability: string;
  sort_order: number;
}

export interface SavedView {
  id: string;
  user_id: string;
  page: string;
  name: string;
  filters: Record<string, unknown>;
}
