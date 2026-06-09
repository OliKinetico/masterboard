"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Scale, Plus, History } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { DocStatusChip } from "@/components/chips";
import {
  DOC_STATUSES, DOC_STATUS_META, DOC_TYPE_LABELS, RESPONSIBLE_LABELS,
} from "@/lib/domain";
import { formatDate, formatDateTime } from "@/lib/format";
import { setDocumentStatus } from "@/server/actions/deal-children";
import { cn } from "@/lib/utils";
import type { Deal, DocumentRow, DocumentStatusHistory, Property } from "@/lib/types";
import { DocCard, DOC_TYPE_ICONS } from "./doc-card";
import { DocDialog, docToForm } from "./doc-dialog";

/**
 * Legal matrix (spec §5.6): rows = this deal's legal docs, columns = the 7
 * statuses; the chip sits in-grid. One screen answers "where is every legal
 * workstream". Row click → versions, link-card, history, responsible, due.
 */
export function LegalTab({
  deal,
  documents,
  docHistory,
  properties,
  profilesById,
  canEdit,
}: {
  deal: Deal;
  documents: DocumentRow[];
  docHistory: DocumentStatusHistory[];
  properties: Property[];
  profilesById: Record<string, string>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [detail, setDetail] = useState<DocumentRow | null>(null);
  const [editForm, setEditForm] = useState<ReturnType<typeof docToForm> | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const historyByDoc = useMemo(() => {
    const map = new Map<string, DocumentStatusHistory[]>();
    for (const h of docHistory) {
      const list = map.get(h.document_id) ?? [];
      list.push(h);
      map.set(h.document_id, list);
    }
    return map;
  }, [docHistory]);

  const propertyById = useMemo(
    () => new Map(properties.map((p) => [p.id, p])),
    [properties],
  );

  function changeStatus(doc: DocumentRow, status: string) {
    if (doc.status === status || !canEdit) return;
    startTransition(async () => {
      const result = await setDocumentStatus(deal.id, doc.id, status);
      if (result.error) toast.error(result.error);
      router.refresh();
    });
  }

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title={deal.hots_signed_at ? "No legal documents yet" : "Legal pack not spawned yet"}
        description={
          deal.hots_signed_at
            ? "Add documents manually, or check the legal pack template in Admin."
            : "Marking Heads of Terms as signed (deal header) spawns the full legal pack — one document per template plus a lease per property."
        }
        action={
          canEdit ? (
            <Button size="sm" variant="outline" onClick={() => { setEditForm(null); setEditOpen(true); }}>
              <Plus /> Add a document manually
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => { setEditForm(null); setEditOpen(true); }}>
            <Plus /> Add document
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b">
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Workstream
              </th>
              {DOC_STATUSES.map((s) => (
                <th key={s} className="px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {DOC_STATUS_META[s].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => {
              const TypeIcon = DOC_TYPE_ICONS[doc.doc_type];
              const property = doc.property_id ? propertyById.get(doc.property_id) : null;
              return (
                <tr key={doc.id} className="border-b last:border-0 hover:bg-slate-50/60">
                  <td className="px-3 py-2">
                    <button
                      className="flex items-center gap-2 text-left hover:text-brand-700 cursor-pointer"
                      onClick={() => setDetail(doc)}
                      data-testid={`legal-row-${doc.doc_type}`}
                    >
                      <TypeIcon className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="font-medium">{doc.title}</span>
                      {doc.version_label ? (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          {doc.version_label}
                        </span>
                      ) : null}
                      {property ? (
                        <span className="truncate text-[10px] text-muted-foreground">
                          {property.address.split(",")[0]}
                        </span>
                      ) : null}
                    </button>
                  </td>
                  {DOC_STATUSES.map((s) => {
                    const isCurrent = doc.status === s;
                    return (
                      <td key={s} className="px-1 py-2 text-center">
                        {isCurrent ? (
                          <DocStatusChip status={s} className="mx-auto" />
                        ) : canEdit ? (
                          <button
                            className="mx-auto block h-2.5 w-2.5 rounded-full bg-slate-100 transition-colors hover:bg-brand-300 cursor-pointer disabled:opacity-50"
                            onClick={() => changeStatus(doc, s)}
                            disabled={pending}
                            title={`Move to ${DOC_STATUS_META[s].label}`}
                            aria-label={`Set ${doc.title} to ${DOC_STATUS_META[s].label}`}
                          />
                        ) : (
                          <span className="mx-auto block h-2.5 w-2.5 rounded-full bg-slate-100/70" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* detail dialog: link-card, responsible, due, full status history */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle>{detail.title}</DialogTitle>
                <DialogDescription>
                  {DOC_TYPE_LABELS[detail.doc_type]} · {RESPONSIBLE_LABELS[detail.responsible]}
                  {detail.due_on ? ` · due ${formatDate(detail.due_on)}` : ""}
                </DialogDescription>
              </DialogHeader>
              <DocCard doc={detail} />
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <History className="h-3.5 w-3.5" /> Status history
                </p>
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {(historyByDoc.get(detail.id) ?? []).map((h) => (
                    <li key={h.id} className="flex items-center gap-2 text-xs">
                      <span className="w-32 shrink-0 text-muted-foreground">
                        {formatDateTime(h.changed_at)}
                      </span>
                      <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px]", h.from_status ? DOC_STATUS_META[h.from_status].chip : "text-muted-foreground")}>
                        {h.from_status ? DOC_STATUS_META[h.from_status].label : "created"}
                      </span>
                      <span className="text-slate-400">→</span>
                      <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px]", DOC_STATUS_META[h.to_status].chip)}>
                        {DOC_STATUS_META[h.to_status].label}
                      </span>
                      {h.changed_by && profilesById[h.changed_by] ? (
                        <span className="truncate text-muted-foreground">
                          {profilesById[h.changed_by]}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
              {canEdit ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditForm(docToForm(detail));
                    setDetail(null);
                    setEditOpen(true);
                  }}
                >
                  Edit details
                </Button>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <DocDialog
        dealId={deal.id}
        properties={properties}
        open={editOpen}
        initial={editForm}
        onClose={() => setEditOpen(false)}
      />
    </div>
  );
}
