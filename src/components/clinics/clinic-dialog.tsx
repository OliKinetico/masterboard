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
import { Checkbox } from "@/components/ui/checkbox";
import { DISCIPLINES, UK_REGIONS } from "@/lib/domain";
import { upsertClinic } from "@/server/actions/entities";
import type { Clinic } from "@/lib/types";

export function ClinicDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial: Clinic | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: "", tradingName: "", addressLine1: "", city: "", postcode: "",
    region: "", companiesHouseNumber: "", website: "", phone: "",
    disciplines: [] as string[], revenueEstimate: "", practitionerCount: "",
    sitesCount: "1", score: "",
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      name: initial?.name ?? "",
      tradingName: initial?.trading_name ?? "",
      addressLine1: initial?.address_line1 ?? "",
      city: initial?.city ?? "",
      postcode: initial?.postcode ?? "",
      region: initial?.region ?? "",
      companiesHouseNumber: initial?.companies_house_number ?? "",
      website: initial?.website ?? "",
      phone: initial?.phone ?? "",
      disciplines: initial?.disciplines ?? [],
      revenueEstimate: initial?.revenue_estimate ?? "",
      practitionerCount: initial?.practitioner_count?.toString() ?? "",
      sitesCount: initial?.sites_count?.toString() ?? "1",
      score: initial?.score ?? "",
    });
  }, [open, initial]);

  function submit() {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    startTransition(async () => {
      const result = await upsertClinic({
        id: initial?.id,
        name: form.name,
        tradingName: form.tradingName || null,
        addressLine1: form.addressLine1 || null,
        city: form.city || null,
        postcode: form.postcode || null,
        region: form.region || null,
        companiesHouseNumber: form.companiesHouseNumber || null,
        website: form.website || null,
        phone: form.phone || null,
        disciplines: form.disciplines,
        revenueEstimate: form.revenueEstimate ? Number(form.revenueEstimate) : null,
        practitionerCount: form.practitionerCount ? Number(form.practitionerCount) : null,
        sitesCount: form.sitesCount ? Number(form.sitesCount) : 1,
        score: form.score ? Number(form.score) : null,
      });
      if (result.error) toast.error(result.error);
      else {
        onClose();
        if (!initial && result.clinicId) router.push(`/clinics/${result.clinicId}`);
      }
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit clinic" : "New clinic"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Trading name</Label>
            <Input value={form.tradingName} onChange={(e) => setForm((f) => ({ ...f, tradingName: e.target.value }))} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Address</Label>
            <Input value={form.addressLine1} onChange={(e) => setForm((f) => ({ ...f, addressLine1: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>City</Label>
            <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Postcode</Label>
            <Input value={form.postcode} onChange={(e) => setForm((f) => ({ ...f, postcode: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Region</Label>
            <Select value={form.region || "none"} onValueChange={(v) => setForm((f) => ({ ...f, region: v === "none" ? "" : v }))}>
              <SelectTrigger><SelectValue placeholder="Region" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unknown</SelectItem>
                {UK_REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Companies House no.</Label>
            <Input value={form.companiesHouseNumber} onChange={(e) => setForm((f) => ({ ...f, companiesHouseNumber: e.target.value }))} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Disciplines</Label>
            <div className="flex flex-wrap gap-3">
              {DISCIPLINES.map((d) => (
                <label key={d} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <Checkbox
                    checked={form.disciplines.includes(d)}
                    onCheckedChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        disciplines: v === true
                          ? [...f.disciplines, d]
                          : f.disciplines.filter((x) => x !== d),
                      }))
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Revenue estimate (£)</Label>
            <Input type="number" value={form.revenueEstimate} onChange={(e) => setForm((f) => ({ ...f, revenueEstimate: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Practitioners</Label>
            <Input type="number" value={form.practitionerCount} onChange={(e) => setForm((f) => ({ ...f, practitionerCount: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Sites</Label>
            <Input type="number" value={form.sitesCount} onChange={(e) => setForm((f) => ({ ...f, sitesCount: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label>Score (0–100)</Label>
            <Input type="number" value={form.score} onChange={(e) => setForm((f) => ({ ...f, score: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={pending}>Save clinic</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
