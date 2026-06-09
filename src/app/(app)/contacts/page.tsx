import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isStaff } from "@/lib/auth";
import type { Contact } from "@/lib/types";
import { ContactsPageClient } from "@/components/contacts/contacts-page-client";

export const metadata = { title: "Contacts" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const page = Math.max(1, Number(params.page ?? 1) || 1);
  let query = supabase
    .from("contacts")
    .select("*, clinics(id, name)", { count: "exact" })
    .is("merged_into_contact_id", null)
    .order("full_name")
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const q = params.q?.trim();
  if (q) query = query.ilike("full_name", `%${q.replaceAll("%", "\\%")}%`);
  if (params.role) query = query.eq("role", params.role);

  const [{ data: contacts, count }, { data: clinics }] = await Promise.all([
    query,
    supabase
      .from("clinics")
      .select("id, name")
      .is("merged_into_clinic_id", null)
      .order("name")
      .limit(500),
  ]);

  return (
    <Suspense>
      <ContactsPageClient
        contacts={(contacts ?? []) as unknown as Array<Contact & { clinics: { id: string; name: string } | null }>}
        clinics={(clinics ?? []) as Array<{ id: string; name: string }>}
        total={count ?? 0}
        page={page}
        pageSize={PAGE_SIZE}
        canCreate={isStaff(profile)}
      />
    </Suspense>
  );
}
