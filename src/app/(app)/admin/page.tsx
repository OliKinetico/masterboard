import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { AdminView } from "@/components/admin/admin-view";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin") redirect("/");
  const supabase = await createClient();

  const [
    { data: profiles },
    { data: access },
    { data: deals },
    { data: legalTemplates },
    { data: checklistTemplates },
    { data: aliases },
    { data: settings },
    { data: syncRuns },
    { data: signals },
    { data: clinics },
    { data: contacts },
    { data: mergeLog },
  ] = await Promise.all([
    supabase.from("user_profiles").select("*").order("full_name"),
    supabase.from("deal_access").select("user_id, deal_id, deals(name)"),
    supabase.from("deals").select("id, name").order("name"),
    supabase.from("legal_pack_templates").select("*").order("sort_order"),
    supabase.from("checklist_templates").select("*, checklist_template_items(*)"),
    supabase
      .from("clinic_aliases")
      .select("id, alias, clinic_id, clinics(name)")
      .order("alias")
      .limit(500),
    supabase.from("column_settings").select("*").order("sort_order"),
    supabase
      .from("sync_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(25),
    supabase
      .from("ch_signals")
      .select("*, clinics(name)")
      .eq("acknowledged", false)
      .order("seen_on", { ascending: false }),
    supabase
      .from("clinics")
      .select("id, name, postcode")
      .is("merged_into_clinic_id", null)
      .order("name")
      .limit(500),
    supabase
      .from("contacts")
      .select("id, full_name, emails")
      .is("merged_into_contact_id", null)
      .order("full_name")
      .limit(500),
    supabase
      .from("merge_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <AdminView
      profiles={profiles ?? []}
      access={(access ?? []) as never}
      deals={deals ?? []}
      legalTemplates={legalTemplates ?? []}
      checklistTemplates={(checklistTemplates ?? []) as never}
      aliases={(aliases ?? []) as never}
      settings={settings ?? []}
      syncRuns={syncRuns ?? []}
      signals={(signals ?? []) as never}
      clinics={clinics ?? []}
      contacts={contacts ?? []}
      mergeLog={mergeLog ?? []}
    />
  );
}
