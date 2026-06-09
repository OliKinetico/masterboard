import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isStaff } from "@/lib/auth";
import type { Clinic } from "@/lib/types";
import { ClinicsPageClient } from "@/components/clinics/clinics-page-client";

export const metadata = { title: "Clinics" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function ClinicsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const page = Math.max(1, Number(params.page ?? 1) || 1);
  let query = supabase
    .from("clinics")
    .select("*", { count: "exact" })
    .is("merged_into_clinic_id", null)
    .order("name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const q = params.q?.trim();
  if (q) {
    const like = `%${q.replaceAll("%", "\\%")}%`;
    query = query.or(
      `name.ilike.${like},postcode.ilike.${like},city.ilike.${like},companies_house_number.ilike.${like}`,
    );
  }
  if (params.region) query = query.eq("region", params.region);
  if (params.disc) query = query.contains("disciplines", [params.disc]);

  const { data: clinics, count } = await query;

  return (
    <Suspense>
      <ClinicsPageClient
        clinics={(clinics ?? []) as Clinic[]}
        total={count ?? 0}
        page={page}
        pageSize={PAGE_SIZE}
        canCreate={isStaff(profile)}
      />
    </Suspense>
  );
}
