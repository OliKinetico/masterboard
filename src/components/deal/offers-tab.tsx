"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HandCoins, Plus } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { OfferStatusChip } from "@/components/chips";
import { EmptyState } from "@/components/ui/empty-state";
import {
  OFFER_TYPES, OFFER_TYPE_LABELS, OFFER_STATUSES, OFFER_STATUS_META,
} from "@/lib/domain";
import { formatGBP, formatDate, formatMultiple } from "@/lib/format";
import { addOffer, setOfferStatus } from "@/server/actions/deal-children";
import type { Offer } from "@/lib/types";

/** Offers (spec §4.5): history timeline + add dialog with 70/30 prefill. */
export function OffersTab({
  dealId,
  offers,
  canEdit,
}: {
  dealId: string;
  offers: Offer[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    offerType: "verbal",
    madeOn: new Date().toISOString().slice(0, 10),
    enterpriseValue: "",
    ebitdaBasis: "",
    cashPct: "70",
    loanNotePct: "30",
    earnOutSummary: "",
    structureNotes: "",
    status: "made",
    supersedePrevious: true,
  });

  const impliedPreview =
    form.enterpriseValue && form.ebitdaBasis && Number(form.ebitdaBasis) !== 0
      ? Number(form.enterpriseValue) / Number(form.ebitdaBasis)
      : null;

  function submit() {
    startTransition(async () => {
      const result = await addOffer({
        dealId,
        offerType: form.offerType,
        madeOn: form.madeOn,
        enterpriseValue: form.enterpriseValue ? Number(form.enterpriseValue) : null,
        ebitdaBasis: form.ebitdaBasis ? Number(form.ebitdaBasis) : null,
        cashPct: Number(form.cashPct),
        loanNotePct: Number(form.loanNotePct),
        earnOutSummary: form.earnOutSummary,
        structureNotes: form.structureNotes,
        status: form.status,
        supersedePrevious: form.supersedePrevious,
      });
      if (result.error) toast.error(result.error);
      else {
        toast.success("Offer recorded");
        setOpen(false);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setOpen(true)} data-testid="add-offer">
            <Plus /> Record offer
          </Button>
        </div>
      ) : null}

      {offers.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="No offers yet"
          description="Verbal ranges, IOIs, LOIs and revisions all live here with their structure and implied multiple."
          action={canEdit ? <Button size="sm" onClick={() => setOpen(true)}>Record the first offer</Button> : undefined}
        />
      ) : (
        <ol className="relative space-y-3 border-l border-slate-200 pl-5">
          {offers.map((offer) => (
            <li key={offer.id} className="relative">
              <span className="absolute -left-[1.6rem] top-2 h-3 w-3 rounded-full border-2 border-brand-400 bg-card" />
              <div className="rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">
                    {OFFER_TYPE_LABELS[offer.offer_type]}
                  </span>
                  <OfferStatusChip status={offer.status} />
                  <span className="text-xs text-muted-foreground">{formatDate(offer.made_on)}</span>
                  {canEdit ? (
                    <Select
                      value={offer.status}
                      onValueChange={(v) =>
                        startTransition(async () => {
                          const r = await setOfferStatus(dealId, offer.id, v);
                          if (r.error) toast.error(r.error);
                          router.refresh();
                        })
                      }
                    >
                      <SelectTrigger className="ml-auto h-6 w-auto gap-1 border-dashed text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OFFER_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{OFFER_STATUS_META[s].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                  <Metric label="Enterprise value" value={formatGBP(offer.enterprise_value)} />
                  <Metric label="EBITDA basis" value={formatGBP(offer.ebitda_basis)} />
                  <Metric label="Implied multiple" value={formatMultiple(offer.implied_multiple)} />
                  <Metric
                    label="Structure"
                    value={`${Number(offer.cash_pct)}% / ${Number(offer.loan_note_pct)}%`}
                    hint="cash / loan notes"
                  />
                </div>
                {offer.earn_out_summary ? (
                  <p className="mt-2 text-xs"><span className="font-medium">Earn-out:</span> {offer.earn_out_summary}</p>
                ) : null}
                {offer.structure_notes ? (
                  <p className="mt-1 text-xs text-muted-foreground">{offer.structure_notes}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record offer</DialogTitle>
            <DialogDescription>
              Cash/loan-note split prefills 70/30; implied multiple is computed from EV ÷ EBITDA.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <Select value={form.offerType} onValueChange={(v) => setForm((f) => ({ ...f, offerType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OFFER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{OFFER_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Date">
              <Input type="date" value={form.madeOn} onChange={(e) => setForm((f) => ({ ...f, madeOn: e.target.value }))} />
            </Field>
            <Field label="Enterprise value (£)">
              <Input type="number" inputMode="numeric" placeholder="2250000" value={form.enterpriseValue}
                onChange={(e) => setForm((f) => ({ ...f, enterpriseValue: e.target.value }))} />
            </Field>
            <Field label="EBITDA basis (£)">
              <Input type="number" inputMode="numeric" placeholder="405000" value={form.ebitdaBasis}
                onChange={(e) => setForm((f) => ({ ...f, ebitdaBasis: e.target.value }))} />
            </Field>
            <Field label="Cash %">
              <Input type="number" value={form.cashPct}
                onChange={(e) => setForm((f) => ({ ...f, cashPct: e.target.value, loanNotePct: String(Math.max(0, 100 - Number(e.target.value || 0))) }))} />
            </Field>
            <Field label="Loan notes %">
              <Input type="number" value={form.loanNotePct}
                onChange={(e) => setForm((f) => ({ ...f, loanNotePct: e.target.value }))} />
            </Field>
            <div className="col-span-2">
              <Field label="Earn-out summary">
                <Input placeholder="e.g. up to £200k over 2 years on revenue retention" value={form.earnOutSummary}
                  onChange={(e) => setForm((f) => ({ ...f, earnOutSummary: e.target.value }))} />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Structure notes">
                <Textarea rows={2} value={form.structureNotes}
                  onChange={(e) => setForm((f) => ({ ...f, structureNotes: e.target.value }))} />
              </Field>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={form.supersedePrevious}
                onCheckedChange={(v) => setForm((f) => ({ ...f, supersedePrevious: v === true }))} />
              Supersede previous open offers
            </label>
            {impliedPreview ? (
              <span data-financial>implied {formatMultiple(impliedPreview)}</span>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={pending}>Save offer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium" data-financial>{value}</p>
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
