/**
 * Domain enums + display metadata. The single source of truth for labels and
 * status colour semantics (spec §3) — UI must never hardcode these elsewhere.
 */

export const PIPELINE_COLUMNS = [
  "identified",
  "silver",
  "gold",
  "platinum",
  "active_discussions",
  "due_diligence",
  "hots",
  "complete",
  "reengage",
  "dead",
] as const;
export type PipelineColumn = (typeof PIPELINE_COLUMNS)[number];

/** Columns where a deal counts as live. */
export function isLiveColumn(col: PipelineColumn): boolean {
  return col !== "complete" && col !== "dead";
}

/** Columns where next_action + next_action_due are required (spec §4.3). */
export const NEXT_ACTION_REQUIRED_COLUMNS: PipelineColumn[] = [
  "active_discussions",
  "due_diligence",
  "hots",
];

export const TIER_COLUMNS = ["silver", "gold", "platinum"] as const;
export type Tier = (typeof TIER_COLUMNS)[number];

/** Linear funnel order for conversion analytics (ASSUMPTIONS #8). */
export const FUNNEL_COLUMNS: PipelineColumn[] = [
  "identified",
  "silver",
  "gold",
  "platinum",
  "active_discussions",
  "due_diligence",
  "hots",
  "complete",
];

interface ColumnMeta {
  label: string;
  /** chip classes (bg + text + border) */
  chip: string;
  /** small dot / accent colour */
  dot: string;
  /** kanban column header accent */
  header: string;
}

export const COLUMN_META: Record<PipelineColumn, ColumnMeta> = {
  identified: {
    label: "Identified",
    chip: "bg-slate-100 text-slate-700 border-slate-200",
    dot: "bg-slate-400",
    header: "border-t-slate-400",
  },
  silver: {
    label: "Silver",
    chip: "bg-gray-100 text-gray-600 border-gray-300",
    dot: "bg-gray-400",
    header: "border-t-gray-400",
  },
  gold: {
    label: "Gold",
    chip: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-400",
    header: "border-t-amber-400",
  },
  platinum: {
    label: "Platinum",
    chip: "bg-violet-50 text-violet-700 border-violet-200",
    dot: "bg-violet-400",
    header: "border-t-violet-400",
  },
  active_discussions: {
    label: "Active Discussions",
    chip: "bg-blue-50 text-blue-700 border-blue-200",
    dot: "bg-blue-500",
    header: "border-t-blue-500",
  },
  due_diligence: {
    label: "Due Diligence",
    chip: "bg-indigo-50 text-indigo-700 border-indigo-200",
    dot: "bg-indigo-500",
    header: "border-t-indigo-500",
  },
  hots: {
    label: "HoTs",
    chip: "bg-teal-50 text-teal-700 border-teal-200",
    dot: "bg-teal-500",
    header: "border-t-teal-500",
  },
  complete: {
    label: "Complete",
    chip: "bg-green-50 text-green-700 border-green-200",
    dot: "bg-green-500",
    header: "border-t-green-500",
  },
  reengage: {
    label: "Re-engage",
    chip: "bg-orange-50 text-orange-700 border-orange-200",
    dot: "bg-orange-400",
    header: "border-t-orange-400",
  },
  dead: {
    label: "Dead",
    chip: "bg-red-50 text-red-600/80 border-red-200",
    dot: "bg-red-300",
    header: "border-t-red-300",
  },
};

export const TIER_META: Record<Tier, { label: string; chip: string }> = {
  silver: { label: "Silver", chip: "bg-gray-100 text-gray-600 border-gray-300" },
  gold: { label: "Gold", chip: "bg-amber-50 text-amber-700 border-amber-300" },
  platinum: {
    label: "Platinum",
    chip: "bg-violet-50 text-violet-700 border-violet-300",
  },
};

export const DOC_STATUSES = [
  "not_started",
  "drafting",
  "issued",
  "with_sellers",
  "marked_up",
  "agreed",
  "signed",
] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const DOC_STATUS_META: Record<DocStatus, { label: string; chip: string; dot: string }> = {
  not_started: {
    label: "Not started",
    chip: "bg-slate-100 text-slate-600 border-slate-200",
    dot: "bg-slate-400",
  },
  drafting: {
    label: "Drafting",
    chip: "bg-blue-50 text-blue-700 border-blue-200",
    dot: "bg-blue-500",
  },
  issued: {
    label: "Issued",
    chip: "bg-indigo-50 text-indigo-700 border-indigo-200",
    dot: "bg-indigo-500",
  },
  with_sellers: {
    label: "With sellers",
    chip: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-400",
  },
  marked_up: {
    label: "Marked up",
    chip: "bg-orange-50 text-orange-700 border-orange-200",
    dot: "bg-orange-400",
  },
  agreed: {
    label: "Agreed",
    chip: "bg-teal-50 text-teal-700 border-teal-200",
    dot: "bg-teal-500",
  },
  signed: {
    label: "Signed",
    chip: "bg-green-50 text-green-700 border-green-200",
    dot: "bg-green-500",
  },
};

export const DOC_TYPES = [
  "hots",
  "spa",
  "loan_notes",
  "earn_out",
  "lease",
  "ddq",
  "employment_contracts",
  "disclosure_letter",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  hots: "Heads of Terms",
  spa: "SPA",
  loan_notes: "Loan Notes",
  earn_out: "Earn-out Agreement",
  lease: "Lease",
  ddq: "DDQ",
  employment_contracts: "Employment Contracts",
  disclosure_letter: "Disclosure Letter",
  other: "Other",
};

export const DOC_LOCATIONS = ["sharepoint", "outlook", "word", "other"] as const;
export type DocLocation = (typeof DOC_LOCATIONS)[number];

export const DOC_LOCATION_LABELS: Record<DocLocation, string> = {
  sharepoint: "SharePoint",
  outlook: "Outlook",
  word: "Word",
  other: "Link",
};

export const RESPONSIBLES = [
  "kinetico",
  "sellers",
  "buyer_solicitors",
  "seller_solicitors",
  "other",
] as const;
export type Responsible = (typeof RESPONSIBLES)[number];

export const RESPONSIBLE_LABELS: Record<Responsible, string> = {
  kinetico: "Kinetico",
  sellers: "Sellers",
  buyer_solicitors: "Buyer solicitors",
  seller_solicitors: "Seller solicitors",
  other: "Other",
};

export const INTERACTION_TYPES = [
  "email",
  "whatsapp_day",
  "call",
  "meeting",
  "note",
] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const INTERACTION_TYPE_LABELS: Record<InteractionType, string> = {
  email: "Email",
  whatsapp_day: "WhatsApp",
  call: "Call",
  meeting: "Meeting",
  note: "Note",
};

export const CONTACT_ROLES = [
  "owner",
  "director",
  "practice_manager",
  "adviser",
  "solicitor",
  "accountant",
  "other",
] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  owner: "Owner",
  director: "Director",
  practice_manager: "Practice Manager",
  adviser: "Adviser",
  solicitor: "Solicitor",
  accountant: "Accountant",
  other: "Other",
};

export const OFFER_TYPES = ["verbal", "ioi", "loi", "revised", "final"] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  verbal: "Verbal",
  ioi: "IOI",
  loi: "LOI",
  revised: "Revised",
  final: "Final",
};

export const OFFER_STATUSES = ["made", "accepted", "rejected", "superseded"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const OFFER_STATUS_META: Record<OfferStatus, { label: string; chip: string }> = {
  made: { label: "Made", chip: "bg-blue-50 text-blue-700 border-blue-200" },
  accepted: { label: "Accepted", chip: "bg-green-50 text-green-700 border-green-200" },
  rejected: { label: "Rejected", chip: "bg-red-50 text-red-600/80 border-red-200" },
  superseded: { label: "Superseded", chip: "bg-slate-100 text-slate-500 border-slate-200" },
};

export const CHANGE_OF_CONTROL = [
  "none",
  "notify_only",
  "consent_required",
  "unknown",
] as const;
export type ChangeOfControl = (typeof CHANGE_OF_CONTROL)[number];

export const COC_META: Record<ChangeOfControl, { label: string; chip: string }> = {
  none: { label: "No CoC clause", chip: "bg-green-50 text-green-700 border-green-200" },
  notify_only: { label: "Notify only", chip: "bg-amber-50 text-amber-700 border-amber-200" },
  consent_required: {
    label: "Consent required",
    chip: "bg-red-50 text-red-700 border-red-200",
  },
  unknown: { label: "CoC unknown", chip: "bg-slate-100 text-slate-600 border-slate-200" },
};

export const DISCIPLINES = ["Chiro", "Physio", "Podiatry", "Osteo", "Other"] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const USER_ROLES = ["admin", "deal_lead", "exec", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  deal_lead: "Deal Lead",
  exec: "Exec",
  viewer: "Viewer",
};

export const CHECKLIST_ITEM_STATUSES = ["open", "in_progress", "done", "n/a"] as const;
export type ChecklistItemStatus = (typeof CHECKLIST_ITEM_STATUSES)[number];

export const CHECKLIST_STATUS_META: Record<
  ChecklistItemStatus,
  { label: string; chip: string }
> = {
  open: { label: "Open", chip: "bg-slate-100 text-slate-600 border-slate-200" },
  in_progress: { label: "In progress", chip: "bg-blue-50 text-blue-700 border-blue-200" },
  done: { label: "Done", chip: "bg-green-50 text-green-700 border-green-200" },
  "n/a": { label: "N/A", chip: "bg-slate-50 text-slate-400 border-slate-200" },
};

export const UK_REGIONS = [
  "London",
  "South East",
  "South West",
  "East of England",
  "East Midlands",
  "West Midlands",
  "Yorkshire",
  "North East",
  "North West",
  "Scotland",
  "Wales",
  "Northern Ireland",
] as const;
