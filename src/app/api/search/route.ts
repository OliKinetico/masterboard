import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Global fuzzy search (spec §5.9). ILIKE against trigram-indexed columns —
 * pg_trgm GIN indexes accelerate %q% patterns, so this stays fast at 10k+
 * rows. With q empty, returns recently-updated deals (quick-log picker).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const supabase = await createClient();

  if (!q) {
    const { data: deals } = await supabase
      .from("deals")
      .select("id, name, pipeline_column, tier")
      .eq("is_live", true)
      .order("updated_at", { ascending: false })
      .limit(8);
    return NextResponse.json({ deals: deals ?? [], clinics: [], contacts: [] });
  }

  const like = `%${q.replaceAll("%", "\\%")}%`;
  const [{ data: deals }, { data: clinics }, { data: contacts }] =
    await Promise.all([
      supabase
        .from("deals")
        .select("id, name, pipeline_column, tier")
        .ilike("name", like)
        .order("updated_at", { ascending: false })
        .limit(6),
      supabase
        .from("clinics")
        .select("id, name, city, postcode, region, companies_house_number")
        .is("merged_into_clinic_id", null)
        .or(
          `name.ilike.${like},postcode.ilike.${like},city.ilike.${like},companies_house_number.ilike.${like},region.ilike.${like}`,
        )
        .limit(6),
      supabase
        .from("contacts")
        .select("id, full_name, role, clinic_id")
        .is("merged_into_contact_id", null)
        .ilike("full_name", like)
        .limit(6),
    ]);

  return NextResponse.json({
    deals: deals ?? [],
    clinics: clinics ?? [],
    contacts: contacts ?? [],
  });
}
