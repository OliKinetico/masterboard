"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  Check,
  FileSignature,
  Pencil,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ColumnChip, TierChip, OfferStatusChip } from "@/components/chips";
import { MoveDialog } from "@/components/pipeline/move-dialog";
import {
  COLUMN_META,
  NEXT_ACTION_REQUIRED_COLUMNS,
  PIPELINE_COLUMNS,
  OFFER_TYPE_LABELS,
  type PipelineColumn,
} from "@/lib/domain";
import { formatDate, formatGBPCompact, formatMultiple, isOverdue } from "@/lib/format";
import { moveDeal, updateDealFields, signHots } from "@/server/actions/deals";
import type { Clinic, Deal, Offer } from "@/lib/types";
import type { PipelineDeal } from "@/components/pipeline/types";
import { cn } from "@/lib/utils";

export function DealHeader({
  deal,
  clinics,
  offers,
  ownerName,
  profiles,
  canEdit,
}: {
  deal: Deal;
  clinics: Clinic[];
  offers: Offer[];
  ownerName: string | null;
  profiles: Array<{ user_id: string; full_name: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingAction, setEditingAction] = useState(false);
  const [actionText, setActionText] = useState(deal.next_action ?? "");
  const [actionDue, setActionDue] = useState(deal.next_action_due ?? "");
  const [movePending, setMovePending] = useState<{
    deal: PipelineDeal;
    to: PipelineColumn;
  } | null>(null);

  const latestOffer =
    offers.find((o) => o.status === "accepted") ??
    offers.find((o) => o.status === "made") ??
    offers[0];

  const needsNextAction =
    NEXT_ACTION_REQUIRED_COLUMNS.includes(deal.pipeline_column) &&
    (!deal.next_action || !deal.next_action_due);

  function changeColumn(to: PipelineColumn) {
    if (to === deal.pipeline_column) return;
    if (to === "dead" || to === "reengage") {
      setMovePending({
        deal: { id: deal.id, name: deal.name } as PipelineDeal,
        to,
      });
      return;
    }
    commitMove(to);
  }

  function commitMove(
    to: PipelineColumn,
    extras?: { deadReason?: string; reengageOn?: string },
  ) {
    startTransition(async () => {
      const result = await moveDeal({ dealId: deal.id, toColumn: to, ...extras });
      if (result.error) toast.error(result.error);
      else {
        toast.success(`Moved to ${COLUMN_META[to].label}`);
        if (result.needsNextAction) setEditingAction(true);
      }
      router.refresh();
    });
  }

  function saveNextAction() {
    startTransition(async () => {
      const result = await updateDealFields(deal.id, {
        next_action: actionText.trim() || null,
        next_action_due: actionDue || null,
      });
      if (result.error) toast.error(result.error);
      else setEditingAction(false);
      router.refresh();
    });
  }

  function onSignHots() {
    startTransition(async () => {
      const result = await signHots(deal.id);
      if (result.error) toast.error(result.error);
      else
        toast.success("HoTs signed — legal pack spawned", {
          description: "One document per template plus a lease per property.",
        });
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{deal.name}</h1>
            <TierChip tier={deal.tier} />
            {canEdit ? (
              <Select value={deal.pipeline_column} onValueChange={(v) => changeColumn(v as PipelineColumn)}>
                <SelectTrigger className="h-7 w-auto gap-1 border-dashed text-xs" disabled={pending}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PIPELINE_COLUMNS.map((c) => (
                    <SelectItem key={c} value={c}>{COLUMN_META[c].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <ColumnChip column={deal.pipeline_column} />
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {clinics.map((c) => (
              <Link key={c.id} href={`/clinics/${c.id}`}>
                <Badge variant="outline" className="gap-1 hover:border-brand-300 hover:bg-brand-50">
                  <Building2 className="h-3 w-3 text-slate-400" />
                  {c.name}
                </Badge>
              </Link>
            ))}
            {clinics.length > 1 ? (
              <Badge className="bg-violet-100 text-violet-700 border-transparent">
                multi-site · {clinics.length}
              </Badge>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Owner: <span className="font-medium text-foreground">{ownerName ?? "Unassigned"}</span></span>
            {deal.first_met_on ? (
              <span>First met {formatDate(deal.first_met_on)}{deal.first_met_context ? ` — ${deal.first_met_context}` : ""}</span>
            ) : null}
            {deal.hots_signed_at ? (
              <span className="inline-flex items-center gap-1 text-teal-700">
                <FileSignature className="h-3 w-3" /> HoTs signed {formatDate(deal.hots_signed_at)}
              </span>
            ) : null}
            {deal.pipeline_column === "reengage" && deal.reengage_on ? (
              <span className="text-orange-600">Re-engage {formatDate(deal.reengage_on)}</span>
            ) : null}
          </div>

          {deal.pipeline_column === "dead" && deal.dead_reason ? (
            <p className="mt-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">
              Dead: {deal.dead_reason}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-2">
          {latestOffer ? (
            <div className="rounded-md border bg-slate-50 px-3 py-2 text-right">
              <div className="flex items-center justify-end gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {OFFER_TYPE_LABELS[latestOffer.offer_type]}
                </span>
                <OfferStatusChip status={latestOffer.status} />
              </div>
              <p className="text-lg font-semibold tracking-tight" data-financial>
                {formatGBPCompact(latestOffer.enterprise_value)}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {latestOffer.implied_multiple ? `${formatMultiple(latestOffer.implied_multiple)} EBITDA` : ""}
                </span>
              </p>
              <p className="text-[11px] text-muted-foreground" data-financial>
                {Number(latestOffer.cash_pct)}% cash / {Number(latestOffer.loan_note_pct)}% loan notes
              </p>
            </div>
          ) : null}
          {canEdit && deal.pipeline_column === "hots" && !deal.hots_signed_at ? (
            <Button size="sm" onClick={onSignHots} disabled={pending} data-testid="sign-hots">
              <FileSignature /> Mark HoTs signed
            </Button>
          ) : null}
          {canEdit ? (
            <Select
              value={deal.owner_user_id ?? "none"}
              onValueChange={(v) =>
                startTransition(async () => {
                  await updateDealFields(deal.id, { owner_user_id: v === "none" ? null : v });
                  router.refresh();
                })
              }
            >
              <SelectTrigger className="h-7 w-auto gap-1 text-xs">
                <SelectValue placeholder="Owner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </div>

      {/* next action — prominent, inline-editable, blocking when required */}
      <div
        className={cn(
          "mt-4 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2",
          needsNextAction
            ? "border-amber-300 bg-amber-50"
            : "border-slate-200 bg-slate-50",
        )}
        data-testid="next-action"
      >
        {needsNextAction ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        ) : (
          <CalendarClock className="h-4 w-4 shrink-0 text-brand-600" />
        )}
        {editingAction && canEdit ? (
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Input
              autoFocus
              className="h-8 flex-1 min-w-48 bg-card"
              placeholder="Next action…"
              value={actionText}
              onChange={(e) => setActionText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveNextAction()}
            />
            <Input
              type="date"
              className="h-8 w-36 bg-card"
              value={actionDue}
              onChange={(e) => setActionDue(e.target.value)}
            />
            <Button size="icon-sm" onClick={saveNextAction} disabled={pending} aria-label="Save next action">
              <Check />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setEditingAction(false)} aria-label="Cancel">
              <X />
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1 text-sm">
              {deal.next_action ? (
                <span className="font-medium">{deal.next_action}</span>
              ) : (
                <span className={cn(needsNextAction ? "font-medium text-amber-700" : "text-muted-foreground")}>
                  {needsNextAction
                    ? `A next action is required while this deal is in ${COLUMN_META[deal.pipeline_column].label}.`
                    : "No next action set."}
                </span>
              )}
              {deal.next_action_due ? (
                <span className={cn("ml-2 text-xs", isOverdue(deal.next_action_due) ? "font-semibold text-red-600" : "text-muted-foreground")}>
                  due {formatDate(deal.next_action_due)}
                </span>
              ) : null}
            </div>
            {canEdit ? (
              <Button
                size="sm"
                variant={needsNextAction ? "default" : "ghost"}
                onClick={() => setEditingAction(true)}
                data-testid="edit-next-action"
              >
                <Pencil /> {deal.next_action ? "Edit" : "Set next action"}
              </Button>
            ) : null}
          </>
        )}
      </div>

      <MoveDialog
        pending={movePending}
        onCancel={() => setMovePending(null)}
        onConfirm={(extras) => {
          if (movePending) commitMove(movePending.to, extras);
          setMovePending(null);
        }}
      />
    </div>
  );
}
