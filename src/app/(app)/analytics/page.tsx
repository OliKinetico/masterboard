import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import {
  FUNNEL_COLUMNS,
  PIPELINE_COLUMNS,
  type PipelineColumn,
} from "@/lib/domain";
import { DEFAULT_REVENUE_MULTIPLE } from "@/lib/analytics/constants";
import {
  AnalyticsView,
  type FunnelStage,
  type WeightedColumn,
  type PulseWeek,
  type StaleDeal,
  type DeadReason,
} from "@/components/analytics/analytics-view";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default async function AnalyticsPage() {
  await getCurrentProfile();
  const supabase = await createClient();

  const twelveWeeksAgo = new Date();
  twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84);

  const [
    { data: deals },
    { data: cardInfo },
    { data: history },
    { data: interactions },
    { data: settings },
  ] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, name, pipeline_column, tier, is_live, dead_reason, clinics!deals_primary_clinic_id_fkey(revenue_estimate, region)",
      ),
    supabase.from("deal_card_info").select("deal_id, latest_offer_ev, last_interaction_on"),
    supabase.from("stage_history").select("deal_id, from_column, to_column, moved_at"),
    supabase
      .from("interactions")
      .select("occurred_on, source")
      .gte("occurred_on", twelveWeeksAgo.toISOString().slice(0, 10)),
    supabase.from("column_settings").select("pipeline_column, probability"),
  ]);

  type DealRow = {
    id: string;
    name: string;
    pipeline_column: PipelineColumn;
    is_live: boolean;
    dead_reason: string | null;
    clinics: { revenue_estimate: string | null; region: string | null } | null;
  };
  const dealRows = (deals ?? []) as unknown as DealRow[];
  const infoByDeal = new Map((cardInfo ?? []).map((c) => [c.deal_id as string, c]));
  const probability = new Map(
    (settings ?? []).map((s) => [s.pipeline_column as PipelineColumn, Number(s.probability)]),
  );

  // ── funnel: reached counts + conversion + median days in stage ──────────
  const reached = new Map<PipelineColumn, Set<string>>();
  for (const col of PIPELINE_COLUMNS) reached.set(col, new Set());
  const byDeal = new Map<string, Array<{ to: PipelineColumn; at: number }>>();
  for (const h of (history ?? []) as Array<{
    deal_id: string;
    to_column: PipelineColumn;
    moved_at: string;
  }>) {
    reached.get(h.to_column)?.add(h.deal_id);
    const list = byDeal.get(h.deal_id) ?? [];
    list.push({ to: h.to_column, at: new Date(h.moved_at).getTime() });
    byDeal.set(h.deal_id, list);
  }

  const stageDurations = new Map<PipelineColumn, number[]>();
  for (const events of byDeal.values()) {
    events.sort((a, b) => a.at - b.at);
    for (let i = 0; i < events.length - 1; i++) {
      const days = (events[i + 1].at - events[i].at) / 86_400_000;
      const list = stageDurations.get(events[i].to) ?? [];
      list.push(days);
      stageDurations.set(events[i].to, list);
    }
  }

  const funnel: FunnelStage[] = FUNNEL_COLUMNS.map((col, i) => {
    const count = reached.get(col)?.size ?? 0;
    const prev = i > 0 ? (reached.get(FUNNEL_COLUMNS[i - 1])?.size ?? 0) : null;
    return {
      column: col,
      reached: count,
      conversionFromPrev: prev ? Math.round((count / prev) * 100) : null,
      medianDays: median(stageDurations.get(col) ?? []),
    };
  });

  // ── weighted pipeline ────────────────────────────────────────────────────
  const weighted: WeightedColumn[] = PIPELINE_COLUMNS.map((col) => {
    const colDeals = dealRows.filter((d) => d.pipeline_column === col);
    const p = probability.get(col) ?? 0;
    let weightedValue = 0;
    let basisValue = 0;
    for (const d of colDeals) {
      const info = infoByDeal.get(d.id);
      const basis = info?.latest_offer_ev
        ? Number(info.latest_offer_ev)
        : d.clinics?.revenue_estimate
          ? Number(d.clinics.revenue_estimate) * DEFAULT_REVENUE_MULTIPLE
          : 0;
      basisValue += basis;
      weightedValue += basis * p;
    }
    return { column: col, count: colDeals.length, weightedValue, basisValue, probability: p };
  });

  // ── activity pulse: interactions/week by source ──────────────────────────
  const weeks: PulseWeek[] = [];
  for (let w = 11; w >= 0; w--) {
    const start = new Date();
    start.setDate(start.getDate() - start.getDay() - w * 7 + 1);
    weeks.push({
      label: `${start.getDate()}/${start.getMonth() + 1}`,
      start: start.toISOString().slice(0, 10),
      manual: 0,
      outlook_sync: 0,
      whatsapp_import: 0,
      pipedrive_migration: 0,
    });
  }
  for (const i of (interactions ?? []) as Array<{ occurred_on: string; source: string }>) {
    for (let w = weeks.length - 1; w >= 0; w--) {
      if (i.occurred_on >= weeks[w].start) {
        const key = i.source as "manual" | "outlook_sync" | "whatsapp_import" | "pipedrive_migration";
        if (key in weeks[w]) weeks[w][key] += 1;
        break;
      }
    }
  }

  // ── stale deals ──────────────────────────────────────────────────────────
  const now = Date.now();
  const stale: StaleDeal[] = dealRows
    .filter((d) => d.is_live)
    .map((d) => {
      const last = infoByDeal.get(d.id)?.last_interaction_on as string | undefined;
      return {
        id: d.id,
        name: d.name,
        column: d.pipeline_column,
        region: d.clinics?.region ?? null,
        lastInteractionOn: last ?? null,
        daysSilent: last
          ? Math.floor((now - new Date(last).getTime()) / 86_400_000)
          : 9999,
      };
    })
    .filter((d) => d.daysSilent >= 14)
    .sort((a, b) => b.daysSilent - a.daysSilent);

  // ── dead reasons ─────────────────────────────────────────────────────────
  const deadMap = new Map<string, DeadReason>();
  for (const d of dealRows.filter((x) => x.pipeline_column === "dead")) {
    const reason = d.dead_reason ?? "No reason recorded";
    const entry = deadMap.get(reason) ?? { reason, count: 0, deals: [] };
    entry.count += 1;
    entry.deals.push(d.name);
    deadMap.set(reason, entry);
  }

  return (
    <AnalyticsView
      funnel={funnel}
      weighted={weighted}
      pulse={weeks}
      stale={stale}
      deadReasons={[...deadMap.values()].sort((a, b) => b.count - a.count)}
      liveCount={dealRows.filter((d) => d.is_live).length}
    />
  );
}
