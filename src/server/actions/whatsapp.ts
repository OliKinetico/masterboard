"use server";

import { revalidatePath } from "next/cache";
import { unzipSync, strFromU8 } from "fflate";
import { createClient } from "@/lib/supabase/server";
import {
  parseWhatsAppExport,
  dayTranscript,
  daySummary,
  type ParseResult,
} from "@/lib/whatsapp/parser";
import { whatsappDayRef } from "@/lib/whatsapp/hash";

/** Extract chat text from a .txt upload or the .txt inside a .zip export. */
function extractText(fileName: string, base64: string): string {
  const bytes = Buffer.from(base64, "base64");
  if (fileName.toLowerCase().endsWith(".zip")) {
    const entries = unzipSync(new Uint8Array(bytes));
    const txtName = Object.keys(entries).find((n) =>
      n.toLowerCase().endsWith(".txt"),
    );
    if (!txtName) throw new Error("No .txt chat file found inside the zip.");
    return strFromU8(entries[txtName]);
  }
  return bytes.toString("utf8");
}

export interface WhatsAppPreview {
  parse: Pick<
    ParseResult,
    "totalMessages" | "totalMediaOmitted" | "systemLinesSkipped" | "dateRange" | "format"
  > & {
    dayCount: number;
    days: Array<{ date: string; messages: number; mediaOmitted: number }>;
    unparseableLines: string[];
  };
  suggestedDeal: { id: string; name: string } | null;
  liveDeals: Array<{ id: string; name: string }>;
}

/** Step 2 of the flow (spec §5.5): parse preview before anything is written. */
export async function previewWhatsApp(
  contactId: string,
  fileName: string,
  base64: string,
): Promise<{ error?: string; preview?: WhatsAppPreview }> {
  let text: string;
  try {
    text = extractText(fileName, base64);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not read file" };
  }

  const parse = parseWhatsAppExport(text);
  if (parse.days.length === 0) {
    return {
      error:
        "No WhatsApp messages found — is this a chat export .txt (without media) or the .zip WhatsApp produces?",
    };
  }

  const supabase = await createClient();
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, clinic_id")
    .eq("id", contactId)
    .single();

  let suggestedDeal: { id: string; name: string } | null = null;
  if (contact?.clinic_id) {
    const { data: links } = await supabase
      .from("deal_clinics")
      .select("deals!inner(id, name, is_live)")
      .eq("clinic_id", contact.clinic_id)
      .eq("deals.is_live", true)
      .limit(1);
    const link = (links?.[0] as unknown as { deals: { id: string; name: string } } | undefined);
    if (link?.deals) suggestedDeal = { id: link.deals.id, name: link.deals.name };
  }

  const { data: liveDeals } = await supabase
    .from("deals")
    .select("id, name")
    .eq("is_live", true)
    .order("updated_at", { ascending: false })
    .limit(50);

  return {
    preview: {
      parse: {
        totalMessages: parse.totalMessages,
        totalMediaOmitted: parse.totalMediaOmitted,
        systemLinesSkipped: parse.systemLinesSkipped,
        dateRange: parse.dateRange,
        format: parse.format,
        dayCount: parse.days.length,
        days: parse.days.map((d) => ({
          date: d.date,
          messages: d.messages.length,
          mediaOmitted: d.mediaOmitted,
        })),
        unparseableLines: parse.unparseableLines,
      },
      suggestedDeal,
      liveDeals: (liveDeals ?? []) as Array<{ id: string; name: string }>,
    },
  };
}

/**
 * Commit: ONE interaction per calendar day, source_ref = sha256(contact+day).
 * Upsert on source_ref — re-uploading a longer export of the same chat
 * REPLACES day rows, never duplicates. Writes a sync_runs reconciliation row.
 */
export async function commitWhatsApp(
  contactId: string,
  dealId: string,
  fileName: string,
  base64: string,
): Promise<{ error?: string; inserted?: number; updated?: number; days?: number }> {
  const supabase = await createClient();

  let text: string;
  try {
    text = extractText(fileName, base64);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not read file" };
  }
  const parse = parseWhatsAppExport(text);
  if (parse.days.length === 0) return { error: "Nothing to import." };

  const { data: run } = await supabase
    .from("sync_runs")
    .insert({ source: "whatsapp", status: "running" })
    .select("id")
    .single();

  const refs = parse.days.map((d) => whatsappDayRef(contactId, d.date));
  const { data: existing } = await supabase
    .from("interactions")
    .select("source_ref")
    .in("source_ref", refs);
  const existingRefs = new Set((existing ?? []).map((e) => e.source_ref as string));

  const rows = parse.days.map((day) => ({
    deal_id: dealId,
    contact_id: contactId,
    occurred_on: day.date,
    type: "whatsapp_day" as const,
    summary: daySummary(day),
    body: dayTranscript(day),
    source: "whatsapp_import" as const,
    source_ref: whatsappDayRef(contactId, day.date),
  }));

  const { error } = await supabase
    .from("interactions")
    .upsert(rows, { onConflict: "source_ref" });

  const inserted = rows.filter((r) => !existingRefs.has(r.source_ref)).length;
  const updated = rows.length - inserted;

  if (run?.id) {
    await supabase
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: error ? "error" : "success",
        error: error?.message ?? null,
        counts: {
          file: fileName,
          days_in_file: parse.days.length,
          messages_in_file: parse.totalMessages,
          media_omitted: parse.totalMediaOmitted,
          system_skipped: parse.systemLinesSkipped,
          unparseable: parse.unparseableLines.length,
          day_rows_inserted: inserted,
          day_rows_updated: updated,
        },
      })
      .eq("id", run.id);
  }

  if (error) return { error: error.message };

  revalidatePath(`/deals/${dealId}`);
  revalidatePath(`/contacts/${contactId}`);
  return { inserted, updated, days: rows.length };
}
