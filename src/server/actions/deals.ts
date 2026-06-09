"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  NEXT_ACTION_REQUIRED_COLUMNS,
  type PipelineColumn,
} from "@/lib/domain";

interface MoveDealInput {
  dealId: string;
  toColumn: PipelineColumn;
  /** required when toColumn = dead */
  deadReason?: string;
  /** required when toColumn = reengage (ISO date) */
  reengageOn?: string;
}

/**
 * Move a deal between pipeline columns. Stage history + tier persistence +
 * checklist/legal spawning are DB triggers; this action enforces the
 * app-layer rules: dead needs a reason, reengage needs a date, and flags
 * (without blocking) a missing next action in the working columns.
 */
export async function moveDeal(input: MoveDealInput) {
  const supabase = await createClient();

  if (input.toColumn === "dead" && !input.deadReason?.trim()) {
    return { error: "A dead reason is required." };
  }
  if (input.toColumn === "reengage" && !input.reengageOn) {
    return { error: "A re-engage date is required." };
  }

  const update: Record<string, unknown> = { pipeline_column: input.toColumn };
  if (input.toColumn === "dead") update.dead_reason = input.deadReason!.trim();
  if (input.toColumn === "reengage") update.reengage_on = input.reengageOn;

  const { data: deal, error } = await supabase
    .from("deals")
    .update(update)
    .eq("id", input.dealId)
    .select("id, name, next_action, next_action_due")
    .single();

  if (error) {
    // surfaced verbatim: includes the "clinic already on a live deal" trigger
    return { error: friendlyDbError(error.message) };
  }

  revalidatePath("/");
  revalidatePath(`/deals/${input.dealId}`);

  const needsNextAction =
    NEXT_ACTION_REQUIRED_COLUMNS.includes(input.toColumn) &&
    (!deal.next_action || !deal.next_action_due);
  return { ok: true, needsNextAction, dealName: deal.name };
}

export async function updateDealFields(
  dealId: string,
  fields: Record<string, unknown>,
) {
  const supabase = await createClient();
  const allowed = [
    "name",
    "next_action",
    "next_action_due",
    "first_met_on",
    "first_met_context",
    "owner_user_id",
    "reengage_on",
    "dead_reason",
    "key_info",
    "hots_signed_at",
    "tier",
  ];
  const update = Object.fromEntries(
    Object.entries(fields).filter(([k]) => allowed.includes(k)),
  );
  if (Object.keys(update).length === 0) return { error: "Nothing to update" };

  const { error } = await supabase.from("deals").update(update).eq("id", dealId);
  if (error) return { error: friendlyDbError(error.message) };

  revalidatePath(`/deals/${dealId}`);
  revalidatePath("/");
  return { ok: true };
}

export async function createDeal(input: {
  name: string;
  primaryClinicId: string;
  extraClinicIds?: string[];
  ownerUserId?: string | null;
  firstMetOn?: string | null;
  firstMetContext?: string | null;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: deal, error } = await supabase
    .from("deals")
    .insert({
      name: input.name.trim(),
      primary_clinic_id: input.primaryClinicId,
      owner_user_id: input.ownerUserId ?? user?.id,
      first_met_on: input.firstMetOn || null,
      first_met_context: input.firstMetContext || null,
    })
    .select("id")
    .single();
  if (error) return { error: friendlyDbError(error.message) };

  const clinicIds = [input.primaryClinicId, ...(input.extraClinicIds ?? [])];
  for (const clinicId of clinicIds) {
    const { error: dcError } = await supabase
      .from("deal_clinics")
      .insert({ deal_id: deal.id, clinic_id: clinicId });
    if (dcError && !dcError.message.includes("duplicate")) {
      return { error: friendlyDbError(dcError.message), dealId: deal.id };
    }
  }

  revalidatePath("/");
  revalidatePath("/deals");
  return { ok: true, dealId: deal.id };
}

export async function signHots(dealId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("deals")
    .update({ hots_signed_at: new Date().toISOString() })
    .eq("id", dealId)
    .is("hots_signed_at", null);
  if (error) return { error: friendlyDbError(error.message) };
  revalidatePath(`/deals/${dealId}`);
  return { ok: true };
}

function friendlyDbError(message: string): string {
  if (message.includes("already belongs to live deal")) {
    return "That clinic is already attached to another live deal — a clinic can only sit on one live deal at a time.";
  }
  if (message.includes("deals_dead_requires_reason")) {
    return "A dead reason is required.";
  }
  if (message.includes("deals_reengage_requires_date")) {
    return "A re-engage date is required.";
  }
  return message;
}
