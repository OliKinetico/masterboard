import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isStaff } from "@/lib/auth";
import { ReengageList } from "@/components/reengage/reengage-list";
import type { Deal } from "@/lib/types";

export const metadata = { title: "Re-engage" };
export const dynamic = "force-dynamic";

export default async function ReengagePage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const { data: deals } = await supabase
    .from("deals")
    .select("*, clinics!deals_primary_clinic_id_fkey(region)")
    .eq("pipeline_column", "reengage")
    .order("reengage_on", { ascending: true });

  return (
    <ReengageList
      deals={(deals ?? []) as unknown as Array<Deal & { clinics: { region: string | null } | null }>}
      canAct={isStaff(profile)}
    />
  );
}
