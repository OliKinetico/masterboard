"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CONTACT_ROLES, CONTACT_ROLE_LABELS } from "@/lib/domain";
import { upsertContact } from "@/server/actions/entities";
import type { Contact } from "@/lib/types";

interface ClinicOption {
  id: string;
  name: string;
}

export function ContactDialog({
  open,
  onClose,
  initial,
  clinics,
  defaultClinicId,
  prefillEmail,
  prefillName,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initial: Contact | null;
  clinics: ClinicOption[];
  defaultClinicId?: string;
  prefillEmail?: string;
  prefillName?: string;
  onSaved?: (contactId: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    fullName: "",
    role: "owner",
    clinicId: "",
    emails: "",
    phone: "",
    whatsappNumber: "",
    notes: "",
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      fullName: initial?.full_name ?? prefillName ?? "",
      role: initial?.role ?? "owner",
      clinicId: initial?.clinic_id ?? defaultClinicId ?? "",
      emails: initial ? initial.emails.join(", ") : (prefillEmail ?? ""),
      phone: initial?.phone ?? "",
      whatsappNumber: initial?.whatsapp_number ?? "",
      notes: initial?.notes ?? "",
    });
  }, [open, initial, defaultClinicId, prefillEmail, prefillName]);

  function submit() {
    if (!form.fullName.trim()) {
      toast.error("Name is required");
      return;
    }
    startTransition(async () => {
      const result = await upsertContact({
        id: initial?.id,
        clinicId: form.clinicId || null,
        fullName: form.fullName,
        role: form.role,
        emails: form.emails.split(/[,;]/).map((e) => e.trim()).filter(Boolean),
        phone: form.phone || null,
        whatsappNumber: form.whatsappNumber || null,
        notes: form.notes || null,
      });
      if (result.error) toast.error(result.error);
      else {
        onClose();
        if (result.contactId && onSaved) onSaved(result.contactId);
      }
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit contact" : "New contact"}</DialogTitle>
          <DialogDescription>
            Multiple emails (comma-separated) all match for the Outlook sync.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Full name *</Label>
            <Input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONTACT_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{CONTACT_ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Clinic</Label>
            <Select value={form.clinicId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, clinicId: v === "none" ? "" : v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No clinic (cross-deal adviser)</SelectItem>
                {clinics.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Emails</Label>
            <Input placeholder="sarah@clinic.co.uk, sarah@gmail.com" value={form.emails}
              onChange={(e) => setForm((f) => ({ ...f, emails: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>WhatsApp (E.164)</Label>
            <Input placeholder="+447700900123" value={form.whatsappNumber}
              onChange={(e) => setForm((f) => ({ ...f, whatsappNumber: e.target.value }))} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>Save contact</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
