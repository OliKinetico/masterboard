import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isStaff } from "@/lib/auth";
import { LegalBoard, type LegalBoardRow } from "@/components/legal/legal-board";
import type { DocumentRow } from "@/lib/types";

export const metadata = { title: "Legal Board" };
export const dynamic = "force-dynamic";

export default async function LegalBoardPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  // every live deal past HoTs × outstanding (unsigned) docs (spec §5.6)
  const { data: docs } = await supabase
    .from("documents")
    .select("*, deals!inner(id, name, is_live, hots_signed_at)")
    .neq("status", "signed")
    .eq("deals.is_live", true)
    .not("deals.hots_signed_at", "is", null);

  const docRows = (docs ?? []) as unknown as Array<
    DocumentRow & { deals: { id: string; name: string } }
  >;

  // staleness = days since the last status change
  const docIds = docRows.map((d) => d.id);
  const { data: history } = docIds.length
    ? await supabase
        .from("document_status_history")
        .select("document_id, changed_at")
        .in("document_id", docIds)
        .order("changed_at", { ascending: false })
    : { data: [] };

  const lastChange = new Map<string, string>();
  for (const h of history ?? []) {
    if (!lastChange.has(h.document_id as string)) {
      lastChange.set(h.document_id as string, h.changed_at as string);
    }
  }

  const now = Date.now();
  const rows: LegalBoardRow[] = docRows.map((d) => {
    const changed = lastChange.get(d.id) ?? d.created_at;
    return {
      doc: d,
      dealId: d.deals.id,
      dealName: d.deals.name,
      staleDays: Math.floor((now - new Date(changed).getTime()) / 86_400_000),
    };
  });

  return <LegalBoard rows={rows} canEdit={isStaff(profile)} />;
}
