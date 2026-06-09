"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getPipedriveProvider } from "@/lib/pipedrive/providers";
import {
  ACTIVITY_TYPE_MAP,
  mapStage,
  matchOrgsToClinics,
  type OrgMatch,
} from "@/lib/pipedrive/mapper";
import type { PipedriveData } from "@/lib/pipedrive/types";
import { COLUMN_META } from "@/lib/domain";

/**
 * Pipedrive migration (spec §5.8). Dry-run (default) produces a markdown
 * reconciliation report; commit applies it idempotently (run twice → no
 * dupes: orgs key on platform_clinic_id `pd-org-{id}`, persons on
 * pipedrive_person_id, deals on pipedrive_deal_id, notes/activities on
 * interactions.source_ref).
 */
export async function runPipedriveMigration(mode: "dry-run" | "commit") {
  const supabase = await createClient();

  const { data: run, error: runError } = await supabase
    .from("sync_runs")
    .insert({ source: "pipedrive", status: "running" })
    .select("id")
    .single();
  if (runError) return { error: runError.message };

  try {
    const provider = getPipedriveProvider();
    const data = await provider.fetchAll();

    const { data: clinics } = await supabase
      .from("clinics")
      .select("id, name, postcode")
      .is("merged_into_clinic_id", null);

    const matches = matchOrgsToClinics(
      data.orgs,
      (clinics ?? []) as Array<{ id: string; name: string; postcode: string | null }>,
    );

    const report = buildReport(data, matches, mode);

    let applied: Record<string, number> = {};
    if (mode === "commit") {
      applied = await applyMigration(supabase, data, matches);
    }

    const counts = {
      mode,
      orgs: data.orgs.length,
      persons: data.persons.length,
      deals: data.deals.length,
      notes: data.notes.length,
      activities: data.activities.length,
      files: data.files.length,
      orgs_matched: matches.filter((m) => m.verdict === "matched").length,
      orgs_ambiguous: matches.filter((m) => m.verdict === "ambiguous").length,
      orgs_unmatched: matches.filter((m) => m.verdict === "unmatched").length,
      ...applied,
      report,
    };

    await supabase
      .from("sync_runs")
      .update({ finished_at: new Date().toISOString(), status: "success", counts })
      .eq("id", run.id);

    revalidatePath("/admin");
    return { report, counts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("sync_runs")
      .update({ finished_at: new Date().toISOString(), status: "error", error: message })
      .eq("id", run.id);
    revalidatePath("/admin");
    return { error: message };
  }
}

function buildReport(
  data: PipedriveData,
  matches: OrgMatch[],
  mode: string,
): string {
  const lines: string[] = [];
  lines.push(`# Pipedrive migration — ${mode === "commit" ? "COMMIT" : "DRY RUN"}`);
  lines.push(`_Generated ${new Date().toISOString()}_`, "");
  lines.push("## Counts per entity", "");
  lines.push("| Entity | In file/API |", "|---|---|");
  lines.push(`| Organisations | ${data.orgs.length} |`);
  lines.push(`| Persons | ${data.persons.length} |`);
  lines.push(`| Deals | ${data.deals.length} |`);
  lines.push(`| Notes | ${data.notes.length} |`);
  lines.push(`| Activities | ${data.activities.length} |`);
  lines.push(`| Files | ${data.files.length} |`, "");

  lines.push("## Org → clinic fuzzy matching", "");
  lines.push("| Pipedrive org | Verdict | Best clinic match | Score |", "|---|---|---|---|");
  for (const m of matches) {
    const verdictLabel =
      m.verdict === "matched"
        ? "✅ matched"
        : m.verdict === "ambiguous"
          ? "⚠️ ambiguous — needs review"
          : "➕ unmatched — will create";
    lines.push(
      `| ${m.org.name} | ${verdictLabel} | ${m.bestClinic?.name ?? "—"} | ${m.score.toFixed(2)} |`,
    );
  }
  lines.push("");
  const ambiguous = matches.filter((m) => m.verdict === "ambiguous");
  if (ambiguous.length) {
    lines.push(
      "> Ambiguous orgs are **skipped on commit** (so are their deals/contacts) until resolved — re-run after merging or renaming.",
      "",
    );
  }

  lines.push("## Deal column mapping", "");
  lines.push("| Pipedrive deal | Stage / status | → pipeline column |", "|---|---|---|");
  for (const deal of data.deals) {
    const { column, needsReview } = mapStage(deal);
    lines.push(
      `| ${deal.title} | ${deal.stage} / ${deal.status} | ${
        column ? COLUMN_META[column].label : "❓ unknown stage"
      }${needsReview ? " (needs review → defaults to Identified)" : ""} |`,
    );
  }
  lines.push("");

  const filesNoUrl = data.files.filter((f) => !f.url);
  lines.push("## Files", "");
  lines.push(
    `${data.files.filter((f) => f.url).length} file(s) with URLs become document link-cards.`,
  );
  if (filesNoUrl.length) {
    lines.push("", "**Manual triage needed (no URL in export):**", "");
    for (const f of filesNoUrl) lines.push(`- ${f.name} (deal ${f.deal_id})`);
  }
  lines.push("");
  lines.push(
    mode === "commit"
      ? "## Applied — re-running is safe (idempotent upserts on external IDs)."
      : "## Dry run only — nothing was written. Run **Commit** to apply.",
  );
  return lines.join("\n");
}

async function applyMigration(
  supabase: Awaited<ReturnType<typeof createClient>>,
  data: PipedriveData,
  matches: OrgMatch[],
): Promise<Record<string, number>> {
  const counts = {
    clinics_created: 0,
    clinics_reused: 0,
    contacts_upserted: 0,
    deals_upserted: 0,
    deals_skipped: 0,
    interactions_upserted: 0,
    documents_created: 0,
  };

  // org → clinic id (matched reuse, unmatched create, ambiguous skip)
  const clinicByOrg = new Map<string, string>();
  for (const m of matches) {
    if (m.verdict === "matched" && m.bestClinic) {
      clinicByOrg.set(m.org.id, m.bestClinic.id);
      counts.clinics_reused += 1;
    } else if (m.verdict === "unmatched") {
      const { data: existing } = await supabase
        .from("clinics")
        .select("id")
        .eq("platform_clinic_id", `pd-org-${m.org.id}`)
        .maybeSingle();
      if (existing) {
        clinicByOrg.set(m.org.id, existing.id);
        counts.clinics_reused += 1;
      } else {
        const { data: created, error } = await supabase
          .from("clinics")
          .insert({
            name: m.org.name,
            address_line1: m.org.address || null,
            postcode: m.org.postcode || null,
            source: "pipedrive_import",
            platform_clinic_id: `pd-org-${m.org.id}`,
          })
          .select("id")
          .single();
        if (error) throw new Error(`clinic create failed: ${error.message}`);
        await supabase
          .from("clinic_aliases")
          .insert({ clinic_id: created.id, alias: m.org.name });
        clinicByOrg.set(m.org.id, created.id);
        counts.clinics_created += 1;
      }
    }
  }

  // persons → contacts (upsert on pipedrive_person_id)
  for (const person of data.persons) {
    const clinicId = clinicByOrg.get(person.org_id) ?? null;
    if (!clinicId && person.org_id) continue; // ambiguous org — skip with its org
    const { error } = await supabase.from("contacts").upsert(
      {
        pipedrive_person_id: person.id,
        clinic_id: clinicId,
        full_name: person.name,
        role: "owner",
        emails: person.email ? [person.email.toLowerCase()] : [],
        phone: person.phone || null,
      },
      { onConflict: "pipedrive_person_id" },
    );
    if (error) throw new Error(`contact upsert failed: ${error.message}`);
    counts.contacts_upserted += 1;
  }

  // deals → deals (upsert on pipedrive_deal_id)
  const dealIdByPd = new Map<string, string>();
  for (const deal of data.deals) {
    const clinicId = clinicByOrg.get(deal.org_id);
    if (!clinicId) {
      counts.deals_skipped += 1;
      continue;
    }
    const { column } = mapStage(deal);
    const target = column ?? "identified";
    const row: Record<string, unknown> = {
      pipedrive_deal_id: deal.id,
      name: deal.title,
      primary_clinic_id: clinicId,
      pipeline_column: target,
      first_met_on: deal.add_time ? deal.add_time.slice(0, 10) : null,
      first_met_context: "Migrated from Pipedrive",
    };
    if (target === "dead") {
      row.dead_reason = deal.lost_reason || "Lost (migrated from Pipedrive, no reason recorded)";
    }
    if (target === "reengage") {
      const inSixWeeks = new Date();
      inSixWeeks.setDate(inSixWeeks.getDate() + 42);
      row.reengage_on = inSixWeeks.toISOString().slice(0, 10);
    }
    const { data: upserted, error } = await supabase
      .from("deals")
      .upsert(row, { onConflict: "pipedrive_deal_id" })
      .select("id")
      .single();
    if (error) {
      // e.g. clinic already on another live deal — count + continue
      counts.deals_skipped += 1;
      continue;
    }
    dealIdByPd.set(deal.id, upserted.id);
    await supabase
      .from("deal_clinics")
      .upsert({ deal_id: upserted.id, clinic_id: clinicId }, { onConflict: "deal_id,clinic_id", ignoreDuplicates: true });
    counts.deals_upserted += 1;
  }

  // notes + activities → interactions (source_ref pd-…)
  for (const note of data.notes) {
    const dealId = dealIdByPd.get(note.deal_id);
    if (!dealId) continue;
    const { error } = await supabase.from("interactions").upsert(
      {
        deal_id: dealId,
        occurred_on: note.add_time.slice(0, 10),
        type: "note",
        summary: note.content.length > 140 ? `${note.content.slice(0, 137)}…` : note.content,
        body: note.content.length > 140 ? note.content : null,
        source: "pipedrive_migration",
        source_ref: `pd-note-${note.id}`,
      },
      { onConflict: "source_ref" },
    );
    if (!error) counts.interactions_upserted += 1;
  }
  for (const activity of data.activities) {
    const dealId = dealIdByPd.get(activity.deal_id);
    if (!dealId) continue;
    const type = ACTIVITY_TYPE_MAP[activity.type] ?? "note";
    const { error } = await supabase.from("interactions").upsert(
      {
        deal_id: dealId,
        occurred_on: activity.due_date || new Date().toISOString().slice(0, 10),
        type,
        subject: activity.subject,
        summary: activity.subject + (activity.done === "1" ? "" : " (was open in Pipedrive)"),
        body: activity.note || null,
        source: "pipedrive_migration",
        source_ref: `pd-activity-${activity.id}`,
      },
      { onConflict: "source_ref" },
    );
    if (!error) counts.interactions_upserted += 1;
  }

  // files with URLs → document link rows
  for (const file of data.files) {
    if (!file.url) continue;
    const dealId = dealIdByPd.get(file.deal_id);
    if (!dealId) continue;
    const { data: existing } = await supabase
      .from("documents")
      .select("id")
      .eq("deal_id", dealId)
      .eq("url", file.url)
      .limit(1);
    if (existing?.length) continue;
    const { error } = await supabase.from("documents").insert({
      deal_id: dealId,
      doc_type: "other",
      title: file.name,
      url: file.url,
      location_hint: file.url.includes("sharepoint") ? "sharepoint" : "other",
    });
    if (!error) counts.documents_created += 1;
  }

  return counts;
}
