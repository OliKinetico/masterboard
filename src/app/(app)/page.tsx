import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { PIPELINE_COLUMNS, type PipelineColumn, type Tier } from "@/lib/domain";
import { DEFAULT_REVENUE_MULTIPLE } from "@/lib/analytics/constants";
import type { PipelineDeal, ColumnSummary } from "@/components/pipeline/types";
import { PipelineView } from "@/components/pipeline/pipeline-view";

export const metadata = { title: "Pipeline" };
export const dynamic = "force-dynamic";

interface RawDeal {
  id: string;
  name: string;
  pipeline_column: PipelineColumn;
  tier: Tier | null;
  owner_user_id: string | null;
  next_action: string | null;
  next_action_due: string | null;
  reengage_on: string | null;
  updated_at: string;
  clinic: {
    region: string | null;
    disciplines: string[];
    score: string | null;
    revenue_estimate: string | null;
  } | null;
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const owner = params.owner ?? "me"; // default filter: owner = me (spec §5.1)
  const tier = params.tier;
  const region = params.region;
  const discipline = params.disc;
  const scoreBand = params.score;

  const clinicJoin =
    region || discipline || scoreBand
      ? "clinic:clinics!deals_primary_clinic_id_fkey!inner"
      : "clinic:clinics!deals_primary_clinic_id_fkey";

  let query = supabase
    .from("deals")
    .select(
      `id, name, pipeline_column, tier, owner_user_id, next_action,
       next_action_due, reengage_on, updated_at,
       ${clinicJoin}(region, disciplines, score, revenue_estimate)`,
    )
    .order("updated_at", { ascending: false });

  if (owner === "me") query = query.eq("owner_user_id", profile.user_id);
  else if (owner !== "all") query = query.eq("owner_user_id", owner);
  if (tier) query = query.eq("tier", tier);
  if (region) query = query.eq("clinic.region", region);
  if (discipline) query = query.contains("clinic.disciplines", [discipline]);
  if (scoreBand === "high") query = query.gte("clinic.score", 75);
  else if (scoreBand === "mid")
    query = query.gte("clinic.score", 50).lt("clinic.score", 75);
  else if (scoreBand === "low") query = query.lt("clinic.score", 50);

  const [{ data: rawDeals }, { data: settings }, { data: profiles }] =
    await Promise.all([
      query,
      supabase
        .from("column_settings")
        .select("pipeline_column, probability, sort_order")
        .order("sort_order"),
      supabase.from("user_profiles").select("user_id, full_name, role"),
    ]);

  const deals = (rawDeals ?? []) as unknown as RawDeal[];
  const dealIds = deals.map((d) => d.id);

  // derived card info (view: latest offer EV, last stage change) + CH signals
  const [{ data: cardInfo }, { data: signalClinics }] = await Promise.all([
    dealIds.length
      ? supabase
          .from("deal_card_info")
          .select("deal_id, latest_offer_ev, last_stage_change_at")
          .in("deal_id", dealIds)
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("ch_signals")
      .select("clinic_id, deals:clinics(deal_clinics(deal_id))")
      .eq("acknowledged", false),
  ]);

  const infoByDeal = new Map(
    (cardInfo ?? []).map((c) => [c.deal_id as string, c]),
  );
  const signalDealIds = new Set<string>();
  for (const s of (signalClinics ?? []) as unknown as Array<{
    deals: { deal_clinics: Array<{ deal_id: string }> } | null;
  }>) {
    for (const dc of s.deals?.deal_clinics ?? []) signalDealIds.add(dc.deal_id);
  }

  const profilesById = new Map(
    (profiles ?? []).map((p) => [p.user_id as string, p.full_name as string]),
  );

  const now = Date.now();
  const pipelineDeals: PipelineDeal[] = deals.map((d) => {
    const info = infoByDeal.get(d.id);
    const lastChange = info?.last_stage_change_at as string | undefined;
    return {
      id: d.id,
      name: d.name,
      pipeline_column: d.pipeline_column,
      tier: d.tier,
      owner_user_id: d.owner_user_id,
      owner_name: d.owner_user_id
        ? (profilesById.get(d.owner_user_id) ?? null)
        : null,
      region: d.clinic?.region ?? null,
      disciplines: d.clinic?.disciplines ?? [],
      score: d.clinic?.score ? Number(d.clinic.score) : null,
      revenue_estimate: d.clinic?.revenue_estimate
        ? Number(d.clinic.revenue_estimate)
        : null,
      latest_offer_ev: info?.latest_offer_ev
        ? Number(info.latest_offer_ev)
        : null,
      next_action: d.next_action,
      next_action_due: d.next_action_due,
      reengage_on: d.reengage_on,
      days_in_column: lastChange
        ? Math.floor((now - new Date(lastChange).getTime()) / 86_400_000)
        : null,
      updated_at: d.updated_at,
      has_ch_signal: signalDealIds.has(d.id),
    };
  });

  const probability = new Map(
    (settings ?? []).map((s) => [
      s.pipeline_column as PipelineColumn,
      Number(s.probability),
    ]),
  );

  const summaries: ColumnSummary[] = PIPELINE_COLUMNS.map((column) => {
    const colDeals = pipelineDeals.filter((d) => d.pipeline_column === column);
    const p = probability.get(column) ?? 0;
    const weightedValue = colDeals.reduce((sum, d) => {
      const basis =
        d.latest_offer_ev ??
        (d.revenue_estimate ? d.revenue_estimate * DEFAULT_REVENUE_MULTIPLE : 0);
      return sum + basis * p;
    }, 0);
    return { column, probability: p, count: colDeals.length, weightedValue };
  });

  return (
    <PipelineView
      deals={pipelineDeals}
      summaries={summaries}
      profiles={(profiles ?? []).map((p) => ({
        user_id: p.user_id as string,
        full_name: p.full_name as string,
      }))}
      currentUserId={profile.user_id}
      isStaff={profile.role === "admin" || profile.role === "deal_lead"}
    />
  );
}
