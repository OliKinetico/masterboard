"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Admin-only actions (RLS enforces admin on every underlying write). */

export async function setUserRole(userId: string, role: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_profiles")
    .update({ role })
    .eq("user_id", userId);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function grantDealAccess(userId: string, dealId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("deal_access")
    .insert({ user_id: userId, deal_id: dealId });
  if (error && !error.message.includes("duplicate")) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function revokeDealAccess(userId: string, dealId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("deal_access")
    .delete()
    .eq("user_id", userId)
    .eq("deal_id", dealId);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function setColumnProbability(column: string, probability: number) {
  const supabase = await createClient();
  if (probability < 0 || probability > 1) return { error: "Probability must be 0–1" };
  const { error } = await supabase
    .from("column_settings")
    .update({ probability })
    .eq("pipeline_column", column);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: true };
}

export async function addClinicAlias(clinicId: string, alias: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("clinic_aliases")
    .insert({ clinic_id: clinicId, alias: alias.trim() });
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function removeClinicAlias(aliasId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("clinic_aliases").delete().eq("id", aliasId);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function acknowledgeChSignal(signalId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("ch_signals")
    .update({ acknowledged: true })
    .eq("id", signalId);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: true };
}

// ── template editors ────────────────────────────────────────────────────────

export async function upsertLegalTemplate(input: {
  id?: string;
  docType: string;
  sortOrder: number;
  initialStatus: string;
  defaultResponsible: string;
}) {
  const supabase = await createClient();
  const row = {
    doc_type: input.docType,
    sort_order: input.sortOrder,
    initial_status: input.initialStatus,
    default_responsible: input.defaultResponsible,
  };
  const { error } = input.id
    ? await supabase.from("legal_pack_templates").update(row).eq("id", input.id)
    : await supabase.from("legal_pack_templates").insert(row);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteLegalTemplate(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("legal_pack_templates").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function upsertChecklistTemplateItem(input: {
  id?: string;
  templateId: string;
  title: string;
  sort: number;
  defaultResponsible: string;
}) {
  const supabase = await createClient();
  const row = {
    template_id: input.templateId,
    title: input.title.trim(),
    sort: input.sort,
    default_responsible: input.defaultResponsible,
  };
  const { error } = input.id
    ? await supabase.from("checklist_template_items").update(row).eq("id", input.id)
    : await supabase.from("checklist_template_items").insert(row);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteChecklistTemplateItem(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("checklist_template_items").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

// ── merge tool (spec §5.11): re-point FKs, soft-mark merged, audited ───────

export async function mergeClinics(keepId: string, mergeId: string) {
  const supabase = await createClient();
  if (keepId === mergeId) return { error: "Pick two different clinics" };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const repointed: Record<string, number> = {};
  const tables: Array<[table: string, column: string]> = [
    ["contacts", "clinic_id"],
    ["properties", "clinic_id"],
    ["ch_signals", "clinic_id"],
  ];
  for (const [table, column] of tables) {
    const { data, error } = await supabase
      .from(table)
      .update({ [column]: keepId })
      .eq(column, mergeId)
      .select("id");
    if (error) return { error: `${table}: ${error.message}` };
    repointed[table] = data?.length ?? 0;
  }

  // deals.primary_clinic_id + deal_clinics rows (insert-then-delete avoids
  // unique violations when the deal already references the kept clinic)
  const { data: primaryDeals, error: pdError } = await supabase
    .from("deals")
    .update({ primary_clinic_id: keepId })
    .eq("primary_clinic_id", mergeId)
    .select("id");
  if (pdError) return { error: `deals: ${pdError.message}` };
  repointed.deals_primary = primaryDeals?.length ?? 0;

  const { data: links } = await supabase
    .from("deal_clinics")
    .select("deal_id")
    .eq("clinic_id", mergeId);
  for (const link of links ?? []) {
    await supabase
      .from("deal_clinics")
      .upsert({ deal_id: link.deal_id, clinic_id: keepId }, { ignoreDuplicates: true });
  }
  await supabase.from("deal_clinics").delete().eq("clinic_id", mergeId);
  repointed.deal_clinics = links?.length ?? 0;

  // keep the duplicate's name working for the email matcher
  const { data: merged } = await supabase
    .from("clinics")
    .select("name")
    .eq("id", mergeId)
    .single();
  if (merged?.name) {
    await supabase
      .from("clinic_aliases")
      .upsert({ clinic_id: keepId, alias: merged.name }, { onConflict: "clinic_id,alias", ignoreDuplicates: true });
  }
  await supabase.from("clinic_aliases").delete().eq("clinic_id", mergeId);

  const { error: markError } = await supabase
    .from("clinics")
    .update({ merged_into_clinic_id: keepId })
    .eq("id", mergeId);
  if (markError) return { error: markError.message };

  await supabase.from("merge_log").insert({
    kind: "clinic",
    kept_id: keepId,
    merged_id: mergeId,
    performed_by: user?.id ?? null,
    detail: repointed,
  });

  revalidatePath("/admin");
  revalidatePath("/clinics");
  return { ok: true, repointed };
}

export async function mergeContacts(keepId: string, mergeId: string) {
  const supabase = await createClient();
  if (keepId === mergeId) return { error: "Pick two different contacts" };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const repointed: Record<string, number> = {};
  const { data: interactions, error: iError } = await supabase
    .from("interactions")
    .update({ contact_id: keepId })
    .eq("contact_id", mergeId)
    .select("id");
  if (iError) return { error: iError.message };
  repointed.interactions = interactions?.length ?? 0;

  // union the email addresses so the matcher keeps working
  const { data: pair } = await supabase
    .from("contacts")
    .select("id, emails")
    .in("id", [keepId, mergeId]);
  const keep = pair?.find((p) => p.id === keepId);
  const merge = pair?.find((p) => p.id === mergeId);
  if (keep && merge) {
    const emails = [...new Set([...(keep.emails ?? []), ...(merge.emails ?? [])])];
    await supabase.from("contacts").update({ emails }).eq("id", keepId);
  }

  const { error: markError } = await supabase
    .from("contacts")
    .update({ merged_into_contact_id: keepId, emails: [] })
    .eq("id", mergeId);
  if (markError) return { error: markError.message };

  await supabase.from("merge_log").insert({
    kind: "contact",
    kept_id: keepId,
    merged_id: mergeId,
    performed_by: user?.id ?? null,
    detail: repointed,
  });

  revalidatePath("/admin");
  revalidatePath("/contacts");
  return { ok: true, repointed };
}
