"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEmailProvider, getMailbox } from "@/lib/email/provider";
import { buildMatcherIndexes, matchEmail } from "@/lib/email/matcher";
import { guessDocType } from "@/lib/email/doc-type-guess";
import type { EmailMessage } from "@/lib/email/types";
import type { DocLocation } from "@/lib/domain";

function locationFromUrl(url: string): DocLocation {
  if (url.includes("sharepoint")) return "sharepoint";
  if (url.includes("outlook.")) return "outlook";
  return "other";
}

/**
 * Outlook sync (spec §5.7). Provider delta → matcher pipeline → idempotent
 * interaction upserts on source_ref. Every run writes ONE sync_runs row with
 * reconciled counts; mismatch ⇒ status=warning. A sync cannot fail silently:
 * any thrown error is recorded on the run row before rethrowing.
 */
export async function runEmailSync(): Promise<{
  error?: string;
  counts?: Record<string, number>;
  status?: string;
}> {
  const supabase = await createClient();

  // delta cursor = end of the last successful run
  const { data: lastRun } = await supabase
    .from("sync_runs")
    .select("finished_at")
    .eq("source", "outlook")
    .in("status", ["success", "warning"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: run, error: runError } = await supabase
    .from("sync_runs")
    .insert({ source: "outlook", status: "running" })
    .select("id")
    .single();
  if (runError) return { error: `Could not start sync run: ${runError.message}` };

  try {
    const provider = getEmailProvider();
    const mailbox = getMailbox();
    const since = lastRun?.finished_at ? new Date(lastRun.finished_at) : null;
    const messages = await provider.listDelta(since);

    // ── build matcher indexes ────────────────────────────────────────────
    const [{ data: contacts }, { data: aliases }, { data: liveLinks }] =
      await Promise.all([
        supabase
          .from("contacts")
          .select("id, emails, clinic_id")
          .is("merged_into_contact_id", null),
        supabase.from("clinic_aliases").select("clinic_id, alias"),
        supabase
          .from("deal_clinics")
          .select("clinic_id, deals!inner(id, is_live)")
          .eq("deals.is_live", true),
      ]);

    const liveDealByClinic = new Map<string, string>();
    for (const link of (liveLinks ?? []) as unknown as Array<{
      clinic_id: string;
      deals: { id: string };
    }>) {
      liveDealByClinic.set(link.clinic_id, link.deals.id);
    }

    const indexes = buildMatcherIndexes(
      (contacts ?? []).map((c) => ({
        id: c.id as string,
        emails: (c.emails ?? []) as string[],
        dealId: c.clinic_id ? (liveDealByClinic.get(c.clinic_id as string) ?? null) : null,
      })),
      (aliases ?? []).map((a) => ({
        clinic_id: a.clinic_id as string,
        alias: a.alias as string,
        dealId: liveDealByClinic.get(a.clinic_id as string) ?? null,
      })),
    );

    // pre-existing graph ids → inserted vs updated reconciliation
    const graphIds = messages.map((m) => m.graphId);
    const { data: existingRows } = graphIds.length
      ? await supabase.from("interactions").select("source_ref").in("source_ref", graphIds)
      : { data: [] };
    const existingRefs = new Set((existingRows ?? []).map((r) => r.source_ref as string));

    const counts = {
      provider_delta: messages.length,
      matched_by_address: 0,
      matched_by_keyword: 0,
      written_new: 0,
      written_updated: 0,
      unmatched_new: 0,
      unmatched_existing: 0,
      attachments_created: 0,
    };

    for (const message of messages) {
      const match = matchEmail(message, indexes, mailbox);
      if (match) {
        if (match.matchedBy === "address") counts.matched_by_address += 1;
        else counts.matched_by_keyword += 1;

        const { error } = await supabase.from("interactions").upsert(
          {
            deal_id: match.dealId,
            contact_id: match.contactId,
            occurred_on: message.receivedAt.slice(0, 10),
            occurred_at: message.receivedAt,
            type: "email",
            direction:
              message.from.address.toLowerCase() === mailbox.toLowerCase()
                ? "outbound"
                : "inbound",
            subject: message.subject,
            summary: message.subject || message.bodyPreview.slice(0, 120),
            body: message.body,
            source: "outlook_sync",
            source_ref: message.graphId,
          },
          { onConflict: "source_ref" },
        );
        if (error) throw new Error(`interaction upsert failed: ${error.message}`);

        if (existingRefs.has(message.graphId)) counts.written_updated += 1;
        else counts.written_new += 1;

        counts.attachments_created += await syncAttachments(
          supabase,
          match.dealId,
          message,
        );
      } else {
        const { data: inserted, error } = await supabase
          .from("unmatched_emails")
          .upsert(
            {
              graph_id: message.graphId,
              from_name: message.from.name,
              from_address: message.from.address,
              to_addresses: message.to.map((t) => t.address),
              subject: message.subject,
              body_preview: message.bodyPreview,
              body: message.body,
              received_at: message.receivedAt,
              attachments: message.attachments,
            },
            { onConflict: "graph_id", ignoreDuplicates: true },
          )
          .select("id");
        if (error) throw new Error(`unmatched upsert failed: ${error.message}`);
        if (inserted?.length) counts.unmatched_new += 1;
        else counts.unmatched_existing += 1;
      }
    }

    // ── reconciliation: in = written + unmatched, or surface a warning ────
    const accounted =
      counts.written_new +
      counts.written_updated +
      counts.unmatched_new +
      counts.unmatched_existing;
    const status = accounted === counts.provider_delta ? "success" : "warning";

    await supabase
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status,
        counts,
        error:
          status === "warning"
            ? `Reconciliation mismatch: ${counts.provider_delta} from provider vs ${accounted} accounted for`
            : null,
      })
      .eq("id", run.id);

    revalidatePath("/unmatched");
    revalidatePath("/admin");
    return { counts, status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        error: message,
      })
      .eq("id", run.id);
    revalidatePath("/admin");
    return { error: message };
  }
}

async function syncAttachments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dealId: string,
  message: EmailMessage,
): Promise<number> {
  let created = 0;
  for (const attachment of message.attachments) {
    if (!attachment.deepLink) continue;
    // idempotency: same deal + same link = same document
    const { data: existing } = await supabase
      .from("documents")
      .select("id")
      .eq("deal_id", dealId)
      .eq("url", attachment.deepLink)
      .limit(1);
    if (existing?.length) continue;

    const { error } = await supabase.from("documents").insert({
      deal_id: dealId,
      doc_type: guessDocType(attachment.name),
      title: attachment.name,
      url: attachment.deepLink,
      location_hint: locationFromUrl(attachment.deepLink),
      status: "not_started",
      responsible: "kinetico",
    });
    if (!error) created += 1;
  }
  return created;
}

/** One-tap assign from the Unmatched Inbox (+ optional new contact). */
export async function assignUnmatchedEmail(input: {
  emailId: string;
  dealId: string;
  createContact?: boolean;
  contactRole?: string;
}) {
  const supabase = await createClient();
  const { data: email } = await supabase
    .from("unmatched_emails")
    .select("*")
    .eq("id", input.emailId)
    .single();
  if (!email) return { error: "Email not found" };

  let contactId: string | null = null;
  if (input.createContact) {
    const { data: deal } = await supabase
      .from("deals")
      .select("primary_clinic_id")
      .eq("id", input.dealId)
      .single();
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .insert({
        clinic_id: deal?.primary_clinic_id ?? null,
        full_name: email.from_name || email.from_address,
        role: input.contactRole ?? "other",
        emails: [email.from_address],
      })
      .select("id")
      .single();
    if (contactError) return { error: contactError.message };
    contactId = contact.id;
  } else {
    // the sender may already exist as a contact (the matcher just had no live deal)
    const { data: existing } = await supabase
      .from("contacts")
      .select("id")
      .contains("emails", [email.from_address])
      .limit(1);
    contactId = existing?.[0]?.id ?? null;
  }

  const { data: interaction, error } = await supabase
    .from("interactions")
    .upsert(
      {
        deal_id: input.dealId,
        contact_id: contactId,
        occurred_on: (email.received_at as string).slice(0, 10),
        occurred_at: email.received_at,
        type: "email",
        direction: "inbound",
        subject: email.subject,
        summary: email.subject || (email.body_preview as string)?.slice(0, 120) || "(no subject)",
        body: email.body,
        source: "outlook_sync",
        source_ref: email.graph_id,
      },
      { onConflict: "source_ref" },
    )
    .select("id")
    .single();
  if (error) return { error: error.message };

  // attachments → document link rows
  for (const att of (email.attachments ?? []) as Array<{ name: string; deepLink: string }>) {
    if (!att.deepLink) continue;
    const { data: existing } = await supabase
      .from("documents")
      .select("id")
      .eq("deal_id", input.dealId)
      .eq("url", att.deepLink)
      .limit(1);
    if (existing?.length) continue;
    await supabase.from("documents").insert({
      deal_id: input.dealId,
      doc_type: guessDocType(att.name),
      title: att.name,
      url: att.deepLink,
      location_hint: locationFromUrl(att.deepLink),
    });
  }

  await supabase
    .from("unmatched_emails")
    .update({
      status: "assigned",
      assigned_deal_id: input.dealId,
      assigned_interaction_id: interaction.id,
    })
    .eq("id", input.emailId);

  revalidatePath("/unmatched");
  revalidatePath(`/deals/${input.dealId}`);
  return { ok: true };
}

export async function dismissUnmatchedEmail(emailId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("unmatched_emails")
    .update({ status: "dismissed" })
    .eq("id", emailId);
  if (error) return { error: error.message };
  revalidatePath("/unmatched");
  return { ok: true };
}
