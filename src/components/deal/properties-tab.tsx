"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Home, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CocChip } from "@/components/chips";
import { EmptyState } from "@/components/ui/empty-state";
import { CHANGE_OF_CONTROL, COC_META } from "@/lib/domain";
import { formatGBP, formatDate, daysAgo } from "@/lib/format";
import { upsertProperty } from "@/server/actions/deal-children";
import type { Clinic, Property } from "@/lib/types";

const emptyForm = {
  id: undefined as string | undefined,
  clinicId: "",
  address: "",
  leasehold: true,
  rentPa: "",
  leaseStart: "",
  leaseExpiry: "",
  breakDate: "",
  leaseLengthYears: "",
  changeOfControl: "unknown",
  registrationRequired: false,
  registrationTouched: false,
  landlordName: "",
  notes: "",
};

/** Properties panel (spec §4.6) with lease expiry / CoC risk chips. */
export function PropertiesTab({
  dealId,
  properties,
  clinics,
  canEdit,
}: {
  dealId: string;
  properties: Property[];
  clinics: Clinic[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [pending, startTransition] = useTransition();

  function openNew() {
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(p: Property) {
    setForm({
      id: p.id,
      clinicId: p.clinic_id ?? "",
      address: p.address,
      leasehold: p.leasehold,
      rentPa: p.rent_pa ?? "",
      leaseStart: p.lease_start ?? "",
      leaseExpiry: p.lease_expiry ?? "",
      breakDate: p.break_date ?? "",
      leaseLengthYears: p.lease_length_years ?? "",
      changeOfControl: p.change_of_control,
      registrationRequired: p.registration_required,
      registrationTouched: true,
      landlordName: p.landlord_name ?? "",
      notes: p.notes ?? "",
    });
    setOpen(true);
  }

  function setLeaseLength(value: string) {
    setForm((f) => ({
      ...f,
      leaseLengthYears: value,
      // UK Land Registry default: leases over 7 years must be registered
      registrationRequired: f.registrationTouched
        ? f.registrationRequired
        : Number(value) > 7,
    }));
  }

  function submit() {
    if (!form.address.trim()) {
      toast.error("Address is required");
      return;
    }
    startTransition(async () => {
      const result = await upsertProperty({
        id: form.id,
        dealId,
        clinicId: form.clinicId || null,
        address: form.address,
        leasehold: form.leasehold,
        rentPa: form.rentPa ? Number(form.rentPa) : null,
        leaseStart: form.leaseStart || null,
        leaseExpiry: form.leaseExpiry || null,
        breakDate: form.breakDate || null,
        leaseLengthYears: form.leaseLengthYears ? Number(form.leaseLengthYears) : null,
        changeOfControl: form.changeOfControl,
        registrationRequired: form.registrationRequired,
        landlordName: form.landlordName || null,
        notes: form.notes || null,
      });
      if (result.error) toast.error(result.error);
      else setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={openNew}><Plus /> Add property</Button>
        </div>
      ) : null}

      {properties.length === 0 ? (
        <EmptyState
          icon={Home}
          title="No properties recorded"
          description="Leases, rent, break dates and change-of-control clauses per site. Lease docs in the legal pack bind to these."
          action={canEdit ? <Button size="sm" onClick={openNew}>Add the first property</Button> : undefined}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {properties.map((p) => {
            const expiryDays = p.lease_expiry ? -(daysAgo(p.lease_expiry) ?? 0) : null;
            const expiringSoon = expiryDays !== null && expiryDays <= 540;
            const breakDays = p.break_date ? -(daysAgo(p.break_date) ?? 0) : null;
            const breakSoon = breakDays !== null && breakDays >= 0 && breakDays <= 180;
            return (
              <div key={p.id} className="rounded-lg border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{p.address}</p>
                  {canEdit ? (
                    <Button size="icon-sm" variant="ghost" onClick={() => openEdit(p)} aria-label="Edit property">
                      <Pencil />
                    </Button>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{p.leasehold ? "Leasehold" : "Freehold"}</Badge>
                  <CocChip coc={p.change_of_control} />
                  {expiringSoon ? (
                    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                      Expires {formatDate(p.lease_expiry)}
                    </Badge>
                  ) : null}
                  {breakSoon ? (
                    <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">
                      Break {formatDate(p.break_date)}
                    </Badge>
                  ) : null}
                  {p.registration_required ? (
                    <Badge variant="outline">Registration required</Badge>
                  ) : null}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <Fact label="Rent p.a." value={formatGBP(p.rent_pa)} financial />
                  <Fact label="Landlord" value={p.landlord_name ?? "—"} />
                  <Fact label="Lease" value={`${formatDate(p.lease_start)} → ${formatDate(p.lease_expiry)}`} />
                  <Fact label="Term" value={p.lease_length_years ? `${Number(p.lease_length_years)} yrs` : "—"} />
                </dl>
                {p.notes ? <p className="mt-2 text-xs text-muted-foreground">{p.notes}</p> : null}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit property" : "Add property"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>Address *</Label>
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Clinic</Label>
              <Select value={form.clinicId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, clinicId: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not linked</SelectItem>
                  {clinics.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Change of control</Label>
              <Select value={form.changeOfControl} onValueChange={(v) => setForm((f) => ({ ...f, changeOfControl: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHANGE_OF_CONTROL.map((c) => (
                    <SelectItem key={c} value={c}>{COC_META[c].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Rent p.a. (£)</Label>
              <Input type="number" value={form.rentPa} onChange={(e) => setForm((f) => ({ ...f, rentPa: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Landlord</Label>
              <Input value={form.landlordName} onChange={(e) => setForm((f) => ({ ...f, landlordName: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Lease start</Label>
              <Input type="date" value={form.leaseStart} onChange={(e) => setForm((f) => ({ ...f, leaseStart: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Lease expiry</Label>
              <Input type="date" value={form.leaseExpiry} onChange={(e) => setForm((f) => ({ ...f, leaseExpiry: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Break date</Label>
              <Input type="date" value={form.breakDate} onChange={(e) => setForm((f) => ({ ...f, breakDate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Term (years)</Label>
              <Input type="number" value={form.leaseLengthYears} onChange={(e) => setLeaseLength(e.target.value)} />
            </div>
            <div className="col-span-2 flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={form.leasehold} onCheckedChange={(v) => setForm((f) => ({ ...f, leasehold: v === true }))} />
                Leasehold
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={form.registrationRequired}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, registrationRequired: v === true, registrationTouched: true }))}
                />
                Registration required
                <span className="text-xs text-muted-foreground">(auto: term &gt; 7 yrs)</span>
              </label>
            </div>
            <div className="col-span-2 space-y-1">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={pending}>Save property</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Fact({ label, value, financial }: { label: string; value: string; financial?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium" data-financial={financial ? "" : undefined}>{value}</p>
    </div>
  );
}
