import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isStaff } from "@/lib/auth";
import { DealHeader } from "@/components/deal/deal-header";
import { DealTabs } from "@/components/deal/deal-tabs";
import type {
  Deal,
  Clinic,
  Offer,
  Property,
  DocumentRow,
  DealChecklist,
  DealChecklistItem,
  Task,
  Comment,
  Contact,
  Interaction,
  StageHistory,
  DocumentStatusHistory,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const { data: deal } = await supabase
    .from("deals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!deal) notFound();

  const [
    { data: dealClinics },
    { data: offers },
    { data: properties },
    { data: documents },
    { data: checklists },
    { data: tasks },
    { data: comments },
    { data: interactions },
    { data: stageHistory },
    { data: profiles },
  ] = await Promise.all([
    supabase
      .from("deal_clinics")
      .select("clinic_id, clinics(*)")
      .eq("deal_id", id),
    supabase
      .from("offers")
      .select("*")
      .eq("deal_id", id)
      .order("made_on", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("properties").select("*").eq("deal_id", id).order("created_at"),
    supabase.from("documents").select("*").eq("deal_id", id).order("created_at"),
    supabase
      .from("deal_checklists")
      .select("*, deal_checklist_items(*)")
      .eq("deal_id", id),
    supabase
      .from("tasks")
      .select("*")
      .eq("deal_id", id)
      .order("status")
      .order("due_on", { ascending: true, nullsFirst: false }),
    supabase
      .from("comments")
      .select("*")
      .eq("deal_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("interactions")
      .select("*")
      .eq("deal_id", id)
      .order("occurred_on", { ascending: false })
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(60),
    supabase
      .from("stage_history")
      .select("*")
      .eq("deal_id", id)
      .order("moved_at", { ascending: false }),
    supabase.from("user_profiles").select("user_id, full_name, role"),
  ]);

  const clinics = ((dealClinics ?? []) as unknown as Array<{ clinics: Clinic }>)
    .map((dc) => dc.clinics)
    .filter(Boolean);

  // contacts: clinic contacts + any cross-deal contacts on the timeline
  const clinicIds = clinics.map((c) => c.id);
  const interactionContactIds = [
    ...new Set(
      ((interactions ?? []) as Interaction[])
        .map((i) => i.contact_id)
        .filter((x): x is string => !!x),
    ),
  ];
  const orParts: string[] = [];
  if (clinicIds.length) orParts.push(`clinic_id.in.(${clinicIds.join(",")})`);
  if (interactionContactIds.length)
    orParts.push(`id.in.(${interactionContactIds.join(",")})`);
  const { data: contacts } = orParts.length
    ? await supabase
        .from("contacts")
        .select("*")
        .is("merged_into_contact_id", null)
        .or(orParts.join(","))
        .order("full_name")
    : { data: [] };

  // doc status history for the legal tab
  const docIds = ((documents ?? []) as DocumentRow[]).map((d) => d.id);
  const { data: docHistory } = docIds.length
    ? await supabase
        .from("document_status_history")
        .select("*")
        .in("document_id", docIds)
        .order("changed_at", { ascending: false })
    : { data: [] };

  const profilesById = Object.fromEntries(
    (profiles ?? []).map((p) => [p.user_id as string, p.full_name as string]),
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <DealHeader
        deal={deal as Deal}
        clinics={clinics}
        offers={(offers ?? []) as Offer[]}
        ownerName={deal.owner_user_id ? (profilesById[deal.owner_user_id] ?? null) : null}
        profiles={(profiles ?? []).map((p) => ({
          user_id: p.user_id as string,
          full_name: p.full_name as string,
        }))}
        canEdit={isStaff(profile)}
      />
      <DealTabs
        deal={deal as Deal}
        clinics={clinics}
        offers={(offers ?? []) as Offer[]}
        properties={(properties ?? []) as Property[]}
        documents={(documents ?? []) as DocumentRow[]}
        docHistory={(docHistory ?? []) as DocumentStatusHistory[]}
        checklists={
          (checklists ?? []) as Array<DealChecklist & { deal_checklist_items: DealChecklistItem[] }>
        }
        tasks={(tasks ?? []) as Task[]}
        comments={(comments ?? []) as Comment[]}
        contacts={(contacts ?? []) as Contact[]}
        interactions={(interactions ?? []) as Interaction[]}
        stageHistory={(stageHistory ?? []) as StageHistory[]}
        profilesById={profilesById}
        role={profile.role}
      />
    </div>
  );
}
