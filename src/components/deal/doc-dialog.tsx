"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DOC_TYPES, DOC_TYPE_LABELS, DOC_STATUSES, DOC_STATUS_META,
  DOC_LOCATIONS, DOC_LOCATION_LABELS, RESPONSIBLES, RESPONSIBLE_LABELS,
} from "@/lib/domain";
import { upsertDocument } from "@/server/actions/deal-children";
import type { DocumentRow, Property } from "@/lib/types";

interface DocForm {
  id?: string;
  docType: string;
  title: string;
  versionLabel: string;
  url: string;
  locationHint: string;
  status: string;
  responsible: string;
  dueOn: string;
  propertyId: string;
}

const blank: DocForm = {
  docType: "other",
  title: "",
  versionLabel: "",
  url: "",
  locationHint: "sharepoint",
  status: "not_started",
  responsible: "kinetico",
  dueOn: "",
  propertyId: "",
};

export function docToForm(doc: DocumentRow): DocForm {
  return {
    id: doc.id,
    docType: doc.doc_type,
    title: doc.title,
    versionLabel: doc.version_label ?? "",
    url: doc.url ?? "",
    locationHint: doc.location_hint,
    status: doc.status,
    responsible: doc.responsible,
    dueOn: doc.due_on ?? "",
    propertyId: doc.property_id ?? "",
  };
}

/** Create/edit dialog for a document (shared by Legal + Documents tabs). */
export function DocDialog({
  dealId,
  properties,
  open,
  initial,
  onClose,
}: {
  dealId: string;
  properties: Property[];
  open: boolean;
  initial: DocForm | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<DocForm>(blank);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) setForm(initial ?? blank);
  }, [open, initial]);

  function submit() {
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }
    startTransition(async () => {
      const result = await upsertDocument({
        id: form.id,
        dealId,
        docType: form.docType,
        title: form.title,
        versionLabel: form.versionLabel || null,
        url: form.url || null,
        locationHint: form.locationHint,
        status: form.status,
        responsible: form.responsible,
        dueOn: form.dueOn || null,
        propertyId: form.propertyId || null,
      });
      if (result.error) toast.error(result.error);
      else onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{form.id ? "Edit document" : "Add document"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label>Title *</Label>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={form.docType} onValueChange={(v) => setForm((f) => ({ ...f, docType: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{DOC_STATUS_META[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Version</Label>
            <Input placeholder="v3" value={form.versionLabel} onChange={(e) => setForm((f) => ({ ...f, versionLabel: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Responsible</Label>
            <Select value={form.responsible} onValueChange={(v) => setForm((f) => ({ ...f, responsible: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RESPONSIBLES.map((r) => (
                  <SelectItem key={r} value={r}>{RESPONSIBLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Link (SharePoint / Outlook / Word)</Label>
            <Input placeholder="https://…" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Opens in</Label>
            <Select value={form.locationHint} onValueChange={(v) => setForm((f) => ({ ...f, locationHint: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOC_LOCATIONS.map((l) => (
                  <SelectItem key={l} value={l}>{DOC_LOCATION_LABELS[l]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Due</Label>
            <Input type="date" value={form.dueOn} onChange={(e) => setForm((f) => ({ ...f, dueOn: e.target.value }))} />
          </div>
          {form.docType === "lease" ? (
            <div className="col-span-2 space-y-1">
              <Label>Bound to property</Label>
              <Select value={form.propertyId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, propertyId: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not bound</SelectItem>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.address}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>Save document</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
