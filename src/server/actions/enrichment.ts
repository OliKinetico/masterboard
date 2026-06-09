"use server";

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getChProvider } from "@/lib/ch/provider";
import { parseCsv } from "@/lib/csv-parse";
import { DISCIPLINES } from "@/lib/domain";

/**
 * Companies House enrichment (spec §5.8): checks last-accounts-made-up-to for
 * clinics on LIVE deals → ch_signals rows → badges on deal cards + Admin.
 */
export async function runChEnrichment() {
  const supabase = await createClient();
  const { data: run, error: runError } = await supabase
    .from("sync_runs")
    .insert({ source: "companies_house", status: "running" })
    .select("id")
    .single();
  if (runError) return { error: runError.message };

  try {
    const provider = getChProvider();

    const { data: liveClinicLinks } = await supabase
      .from("deal_clinics")
      .select("clinic_id, deals!inner(is_live), clinics!inner(id, name, companies_house_number, ch_last_accounts_date)")
      .eq("deals.is_live", true)
      .not("clinics.companies_house_number", "is", null);

    const seen = new Set<string>();
    let checked = 0;
    let signals = 0;
    let updated = 0;

    for (const link of (liveClinicLinks ?? []) as unknown as Array<{
      clinics: {
        id: string;
        name: string;
        companies_house_number: string;
        ch_last_accounts_date: string | null;
      };
    }>) {
      const clinic = link.clinics;
      if (seen.has(clinic.id)) continue;
      seen.add(clinic.id);
      checked += 1;

      const info = await provider.getCompany(clinic.companies_house_number);
      if (!info?.lastAccountsMadeUpTo) continue;

      const known = clinic.ch_last_accounts_date;
      if (!known || info.lastAccountsMadeUpTo > known) {
        // avoid duplicate unacknowledged signals for the same filing
        const { data: existing } = await supabase
          .from("ch_signals")
          .select("id")
          .eq("clinic_id", clinic.id)
          .eq("signal_type", "accounts_filed")
          .contains("detail", { made_up_to: info.lastAccountsMadeUpTo })
          .limit(1);
        if (!existing?.length) {
          await supabase.from("ch_signals").insert({
            clinic_id: clinic.id,
            signal_type: "accounts_filed",
            detail: {
              made_up_to: info.lastAccountsMadeUpTo,
              previously_known: known,
              company_name: info.companyName,
            },
          });
          signals += 1;
        }
        await supabase
          .from("clinics")
          .update({ ch_last_accounts_date: info.lastAccountsMadeUpTo })
          .eq("id", clinic.id);
        updated += 1;
      }
    }

    const counts = { clinics_checked: checked, signals_created: signals, clinics_updated: updated };
    await supabase
      .from("sync_runs")
      .update({ finished_at: new Date().toISOString(), status: "success", counts })
      .eq("id", run.id);
    revalidatePath("/admin");
    revalidatePath("/");
    return { counts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("sync_runs")
      .update({ finished_at: new Date().toISOString(), status: "error", error: message })
      .eq("id", run.id);
    return { error: message };
  }
}

/**
 * Clinic import (spec §5.8): reads /imports/clinics.csv (or .json).
 * Idempotent on platform_clinic_id; rows without one are matched on exact
 * name+postcode, else created with a derived platform id. Reconciliation
 * (in / written / skipped with reasons) persists to sync_runs.
 */
export async function runClinicImport() {
  const supabase = await createClient();
  const { data: run, error: runError } = await supabase
    .from("sync_runs")
    .insert({ source: "clinic_import", status: "running" })
    .select("id")
    .single();
  if (runError) return { error: runError.message };

  try {
    const csvPath = path.join(process.cwd(), "imports", "clinics.csv");
    const jsonPath = path.join(process.cwd(), "imports", "clinics.json");

    let rows: Array<Record<string, string>> = [];
    let sourceFile = "";
    if (existsSync(csvPath)) {
      rows = parseCsv(readFileSync(csvPath, "utf8"));
      sourceFile = "imports/clinics.csv";
    } else if (existsSync(jsonPath)) {
      rows = JSON.parse(readFileSync(jsonPath, "utf8"));
      sourceFile = "imports/clinics.json";
    } else {
      const counts = {
        note: "No imports/clinics.csv or .json found — the database ships pre-seeded with the generated clinic set (see imports/clinics.example.csv for the expected columns).",
        records_in: 0, created: 0, updated: 0, skipped: 0,
      };
      await supabase
        .from("sync_runs")
        .update({ finished_at: new Date().toISOString(), status: "success", counts })
        .eq("id", run.id);
      revalidatePath("/admin");
      return { counts };
    }

    let created = 0;
    let updatedCount = 0;
    const skipped: Array<{ row: number; reason: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.name?.trim()) {
        skipped.push({ row: i + 2, reason: "missing name" });
        continue;
      }
      const disciplines = (r.disciplines ?? "")
        .split(/[;|]/)
        .map((d) => d.trim())
        .filter((d) => (DISCIPLINES as readonly string[]).includes(d));

      const platformId =
        r.platform_clinic_id?.trim() ||
        `csv-${r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${(r.postcode ?? "").toLowerCase().replace(/\s/g, "")}`;

      const row = {
        name: r.name.trim(),
        trading_name: r.trading_name || null,
        address_line1: r.address_line1 || null,
        address_line2: r.address_line2 || null,
        city: r.city || null,
        postcode: r.postcode || null,
        region: r.region || null,
        lat: r.lat ? Number(r.lat) : null,
        lng: r.lng ? Number(r.lng) : null,
        companies_house_number: r.companies_house_number || null,
        website: r.website || null,
        phone: r.phone || null,
        disciplines,
        revenue_estimate: r.revenue_estimate ? Number(r.revenue_estimate) : null,
        practitioner_count: r.practitioner_count ? Number(r.practitioner_count) : null,
        sites_count: r.sites_count ? Number(r.sites_count) : 1,
        score: r.score ? Number(r.score) : null,
        source: "platform_import" as const,
        platform_clinic_id: platformId,
      };

      const { data: existing } = await supabase
        .from("clinics")
        .select("id")
        .eq("platform_clinic_id", platformId)
        .maybeSingle();

      const { error } = await supabase
        .from("clinics")
        .upsert(row, { onConflict: "platform_clinic_id" });
      if (error) {
        skipped.push({ row: i + 2, reason: error.message });
        continue;
      }
      if (existing) updatedCount += 1;
      else created += 1;
    }

    const counts = {
      file: sourceFile,
      records_in: rows.length,
      created,
      updated: updatedCount,
      skipped: skipped.length,
      skip_reasons: skipped.slice(0, 20),
    };
    await supabase
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: skipped.length ? "warning" : "success",
        counts,
        error: skipped.length ? `${skipped.length} row(s) skipped` : null,
      })
      .eq("id", run.id);
    revalidatePath("/admin");
    revalidatePath("/clinics");
    return { counts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("sync_runs")
      .update({ finished_at: new Date().toISOString(), status: "error", error: message })
      .eq("id", run.id);
    return { error: message };
  }
}
