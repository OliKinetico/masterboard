"use client";

import { useState } from "react";
import { FolderOpen, Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { DocumentRow, Property } from "@/lib/types";
import { DocCard } from "./doc-card";
import { DocDialog, docToForm } from "./doc-dialog";

/** All documents as link-cards (spec §5.2 Documents section). */
export function DocumentsTab({
  dealId,
  documents,
  properties,
  canEdit,
}: {
  dealId: string;
  documents: DocumentRow[];
  properties: Property[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ReturnType<typeof docToForm> | null>(null);

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => { setForm(null); setOpen(true); }}>
            <Plus /> Add document
          </Button>
        </div>
      ) : null}

      {documents.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No documents linked"
          description="Documents are link-cards out to SharePoint, Outlook or Word — synced email attachments also land here."
          action={canEdit ? <Button size="sm" onClick={() => { setForm(null); setOpen(true); }}>Link the first document</Button> : undefined}
        />
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {documents.map((doc) => (
            <div key={doc.id} className="group relative">
              <DocCard doc={doc} />
              {canEdit ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100 bg-card"
                  onClick={(e) => {
                    e.preventDefault();
                    setForm(docToForm(doc));
                    setOpen(true);
                  }}
                  aria-label={`Edit ${doc.title}`}
                >
                  <Pencil />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <DocDialog
        dealId={dealId}
        properties={properties}
        open={open}
        initial={form}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
