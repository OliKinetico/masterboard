"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** CRUD server actions for deal child entities. Writes are RLS-gated. */

function revalidateDeal(dealId: string) {
  revalidatePath(`/deals/${dealId}`);
}

// ── offers ──────────────────────────────────────────────────────────────────
export async function addOffer(input: {
  dealId: string;
  offerType: string;
  madeOn: string;
  enterpriseValue: number | null;
  ebitdaBasis: number | null;
  cashPct: number;
  loanNotePct: number;
  earnOutSummary?: string | null;
  structureNotes?: string | null;
  status: string;
  supersedePrevious?: boolean;
}) {
  const supabase = await createClient();
  if (input.supersedePrevious) {
    await supabase
      .from("offers")
      .update({ status: "superseded" })
      .eq("deal_id", input.dealId)
      .eq("status", "made");
  }
  const { error } = await supabase.from("offers").insert({
    deal_id: input.dealId,
    offer_type: input.offerType,
    made_on: input.madeOn,
    enterprise_value: input.enterpriseValue,
    ebitda_basis: input.ebitdaBasis,
    cash_pct: input.cashPct,
    loan_note_pct: input.loanNotePct,
    earn_out_summary: input.earnOutSummary || null,
    structure_notes: input.structureNotes || null,
    status: input.status,
  });
  if (error) return { error: error.message };
  revalidateDeal(input.dealId);
  return { ok: true };
}

export async function setOfferStatus(dealId: string, offerId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("offers").update({ status }).eq("id", offerId);
  if (error) return { error: error.message };
  revalidateDeal(dealId);
  return { ok: true };
}

// ── properties ──────────────────────────────────────────────────────────────
export async function upsertProperty(input: {
  id?: string;
  dealId: string;
  clinicId?: string | null;
  address: string;
  leasehold: boolean;
  rentPa: number | null;
  leaseStart: string | null;
  leaseExpiry: string | null;
  breakDate: string | null;
  leaseLengthYears: number | null;
  changeOfControl: string;
  registrationRequired: boolean;
  landlordName: string | null;
  notes: string | null;
}) {
  const supabase = await createClient();
  const row = {
    deal_id: input.dealId,
    clinic_id: input.clinicId || null,
    address: input.address.trim(),
    leasehold: input.leasehold,
    rent_pa: input.rentPa,
    lease_start: input.leaseStart || null,
    lease_expiry: input.leaseExpiry || null,
    break_date: input.breakDate || null,
    lease_length_years: input.leaseLengthYears,
    change_of_control: input.changeOfControl,
    registration_required: input.registrationRequired,
    landlord_name: input.landlordName || null,
    notes: input.notes || null,
  };
  const { error } = input.id
    ? await supabase.from("properties").update(row).eq("id", input.id)
    : await supabase.from("properties").insert(row);
  if (error) return { error: error.message };
  revalidateDeal(input.dealId);
  return { ok: true };
}

// ── documents ───────────────────────────────────────────────────────────────
export async function upsertDocument(input: {
  id?: string;
  dealId: string;
  docType: string;
  title: string;
  versionLabel?: string | null;
  url?: string | null;
  locationHint: string;
  status: string;
  responsible: string;
  dueOn?: string | null;
  propertyId?: string | null;
}) {
  const supabase = await createClient();
  const row = {
    deal_id: input.dealId,
    doc_type: input.docType,
    title: input.title.trim(),
    version_label: input.versionLabel || null,
    url: input.url || null,
    location_hint: input.locationHint,
    status: input.status,
    responsible: input.responsible,
    due_on: input.dueOn || null,
    property_id: input.propertyId || null,
  };
  const { error } = input.id
    ? await supabase.from("documents").update(row).eq("id", input.id)
    : await supabase.from("documents").insert(row);
  if (error) return { error: error.message };
  revalidateDeal(input.dealId);
  revalidatePath("/legal-board");
  return { ok: true };
}

export async function setDocumentStatus(
  dealId: string,
  documentId: string,
  status: string,
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("documents")
    .update({ status })
    .eq("id", documentId);
  if (error) return { error: error.message };
  revalidateDeal(dealId);
  revalidatePath("/legal-board");
  return { ok: true };
}

// ── checklists ──────────────────────────────────────────────────────────────
export async function setChecklistItem(
  dealId: string,
  itemId: string,
  fields: { status?: string; responsible?: string; dueOn?: string | null; note?: string | null },
) {
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (fields.status !== undefined) update.status = fields.status;
  if (fields.responsible !== undefined) update.responsible = fields.responsible;
  if (fields.dueOn !== undefined) update.due_on = fields.dueOn;
  if (fields.note !== undefined) update.note = fields.note;
  const { error } = await supabase
    .from("deal_checklist_items")
    .update(update)
    .eq("id", itemId);
  if (error) return { error: error.message };
  revalidateDeal(dealId);
  return { ok: true };
}

export async function addChecklistItem(
  dealId: string,
  checklistId: string,
  title: string,
) {
  const supabase = await createClient();
  const { data: maxSort } = await supabase
    .from("deal_checklist_items")
    .select("sort")
    .eq("checklist_id", checklistId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("deal_checklist_items").insert({
    checklist_id: checklistId,
    title: title.trim(),
    sort: (maxSort?.sort ?? 0) + 1,
  });
  if (error) return { error: error.message };
  revalidateDeal(dealId);
  return { ok: true };
}

// ── tasks ───────────────────────────────────────────────────────────────────
export async function addTask(input: {
  dealId: string;
  title: string;
  dueOn?: string | null;
  ownerUserId?: string | null;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("tasks").insert({
    deal_id: input.dealId,
    title: input.title.trim(),
    due_on: input.dueOn || null,
    owner_user_id: input.ownerUserId ?? user?.id ?? null,
  });
  if (error) return { error: error.message };
  revalidateDeal(input.dealId);
  return { ok: true };
}

export async function toggleTask(dealId: string, taskId: string, done: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ status: done ? "done" : "open" })
    .eq("id", taskId);
  if (error) return { error: error.message };
  revalidateDeal(dealId);
  return { ok: true };
}

// ── comments ────────────────────────────────────────────────────────────────
export async function addComment(dealId: string, body: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };
  const trimmed = body.trim();
  if (!trimmed) return { error: "Comment is empty" };
  const { error } = await supabase.from("comments").insert({
    deal_id: dealId,
    author_user_id: user.id,
    body: trimmed,
  });
  if (error) return { error: error.message };
  revalidateDeal(dealId);
  return { ok: true };
}

// ── deal clinics ────────────────────────────────────────────────────────────
export async function addDealClinic(dealId: string, clinicId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("deal_clinics")
    .insert({ deal_id: dealId, clinic_id: clinicId });
  if (error) {
    return {
      error: error.message.includes("already belongs")
        ? "That clinic is already on another live deal."
        : error.message,
    };
  }
  revalidateDeal(dealId);
  return { ok: true };
}
