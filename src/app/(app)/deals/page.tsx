import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isStaff } from "@/lib/auth";
import type { PipelineColumn, Tier } from "@/lib/domain";
import type { PipelineDeal } from "@/components/pipeline/types";
import { DealsPageClient } from "@/components/deals/deals-page-client";

export const metadata = { title: "Deals" };
export const dynamic = "force-dynamic";

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  let query = supabase
    .from("deals")
    .select(
      `id, name, pipeline_column, tier, owner_user_id, next_action,
       next_action_due, reengage_on, updated_at,
       clinic:clinics!deals_primary_clinic_id_fkey(region, disciplines, score, revenue_estimate)`,
    )
    .order("updated_at", { ascending: false })
    .limit(500);

  const q = params.q?.trim();
  if (q) query = query.ilike("name", `%${q.replaceAll("%", "\\%")}%`);
  if (params.status === "live") query = query.eq("is_live", true);
  if (params.status === "closed") query = query.eq("is_live", false);

  const [{ data: rawDeals }, { data: cardInfo }, { data: profiles }] =
    await Promise.all([
      query,
      supabase.from("deal_card_info").select("deal_id, latest_offer_ev, last_stage_change_at"),
      supabase.from("user_profiles").select("user_id, full_name"),
    ]);

  const infoByDeal = new Map((cardInfo ?? []).map((c) => [c.deal_id as string, c]));
  const profilesById = new Map(
    (profiles ?? []).map((p) => [p.user_id as string, p.full_name as string]),
  );

  const now = Date.now();
  const deals: PipelineDeal[] = (
    (rawDeals ?? []) as unknown as Array<{
      id: string; name: string; pipeline_column: PipelineColumn; tier: Tier | null;
      owner_user_id: string | null; next_action: string | null;
      next_action_due: string | null; reengage_on: string | null; updated_at: string;
      clinic: { region: string | null; disciplines: string[]; score: string | null; revenue_estimate: string | null } | null;
    }>
  ).map((d) => {
    const info = infoByDeal.get(d.id);
    const lastChange = info?.last_stage_change_at as string | undefined;
    return {
      id: d.id,
      name: d.name,
      pipeline_column: d.pipeline_column,
      tier: d.tier,
      owner_user_id: d.owner_user_id,
      owner_name: d.owner_user_id ? (profilesById.get(d.owner_user_id) ?? null) : null,
      region: d.clinic?.region ?? null,
      disciplines: d.clinic?.disciplines ?? [],
      score: d.clinic?.score ? Number(d.clinic.score) : null,
      revenue_estimate: d.clinic?.revenue_estimate ? Number(d.clinic.revenue_estimate) : null,
      latest_offer_ev: info?.latest_offer_ev ? Number(info.latest_offer_ev) : null,
      next_action: d.next_action,
      next_action_due: d.next_action_due,
      reengage_on: d.reengage_on,
      days_in_column: lastChange
        ? Math.floor((now - new Date(lastChange).getTime()) / 86_400_000)
        : null,
      updated_at: d.updated_at,
      has_ch_signal: false,
    };
  });

  return (
    <Suspense>
      <DealsPageClient deals={deals} canCreate={isStaff(profile)} />
    </Suspense>
  );
}
