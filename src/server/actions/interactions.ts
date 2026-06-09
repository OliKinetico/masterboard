"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

interface QuickLogInput {
  dealId: string;
  type: "call" | "meeting" | "note";
  text: string;
  contactId?: string | null;
  followUpTitle?: string | null;
  followUpDue?: string | null;
}

/** Quick-log (spec §5.3): one interaction + optional follow-up task. */
export async function quickLog(input: QuickLogInput) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const text = input.text.trim();
  if (!text) return { error: "Add a line about what happened" };
  const summary = text.length > 140 ? `${text.slice(0, 137)}…` : text;

  const { data: interaction, error } = await supabase
    .from("interactions")
    .insert({
      deal_id: input.dealId,
      contact_id: input.contactId ?? null,
      occurred_on: new Date().toISOString().slice(0, 10),
      occurred_at: new Date().toISOString(),
      type: input.type,
      summary,
      body: text.length > 140 ? text : null,
      source: "manual",
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  if (input.followUpTitle?.trim()) {
    const { error: taskError } = await supabase.from("tasks").insert({
      deal_id: input.dealId,
      title: input.followUpTitle.trim(),
      owner_user_id: user.id,
      due_on: input.followUpDue || null,
      created_from_interaction_id: interaction.id,
    });
    if (taskError) return { error: `Logged, but task failed: ${taskError.message}` };
  }

  revalidatePath(`/deals/${input.dealId}`);
  return { ok: true };
}

export async function logInteraction(input: {
  dealId: string;
  type: "email" | "whatsapp_day" | "call" | "meeting" | "note";
  occurredOn: string;
  summary: string;
  body?: string | null;
  direction?: "inbound" | "outbound" | null;
  subject?: string | null;
  contactId?: string | null;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("interactions").insert({
    deal_id: input.dealId,
    contact_id: input.contactId ?? null,
    occurred_on: input.occurredOn,
    type: input.type,
    direction: input.direction ?? null,
    subject: input.subject ?? null,
    summary: input.summary,
    body: input.body ?? null,
    source: "manual",
  });
  if (error) return { error: error.message };
  revalidatePath(`/deals/${input.dealId}`);
  return { ok: true };
}
