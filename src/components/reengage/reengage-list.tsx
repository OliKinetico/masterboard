"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TierChip } from "@/components/chips";
import { moveDeal } from "@/server/actions/deals";
import { formatDate, daysAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Deal } from "@/lib/types";

type ReengageDeal = Deal & { clinics: { region: string | null } | null };

/**
 * Re-engage view (spec §5.12): due ≤ today+14 highlighted at the top.
 * Re-opening moves the deal to Active Discussions; the DB trigger clears
 * reengage_on automatically.
 */
export function ReengageList({
  deals,
  canAct,
}: {
  deals: ReengageDeal[];
  canAct: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const dueSoon = deals.filter((d) => {
    const days = d.reengage_on ? -(daysAgo(d.reengage_on) ?? 0) : Infinity;
    return days <= 14;
  });
  const later = deals.filter((d) => !dueSoon.includes(d));

  function reopen(deal: ReengageDeal) {
    startTransition(async () => {
      const result = await moveDeal({ dealId: deal.id, toColumn: "active_discussions" });
      if (result.error) toast.error(result.error);
      else toast.success(`${deal.name} re-opened in Active Discussions`);
      router.refresh();
    });
  }

  function row(deal: ReengageDeal, hot: boolean) {
    const overdue = deal.reengage_on ? (daysAgo(deal.reengage_on) ?? 0) > 0 : false;
    return (
      <li
        key={deal.id}
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2.5",
          hot && "border-orange-300 bg-orange-50/50",
        )}
      >
        <div className="min-w-0 flex-1">
          <Link href={`/deals/${deal.id}`} className="text-sm font-medium hover:text-brand-700 hover:underline">
            {deal.name}
          </Link>
          <p className="text-xs text-muted-foreground">
            {deal.clinics?.region ?? "—"}
            {deal.key_info && Object.keys(deal.key_info).length
              ? ` · ${Object.entries(deal.key_info)[0].map(String).join(": ")}`
              : ""}
          </p>
        </div>
        <TierChip tier={deal.tier} />
        <Badge
          variant="outline"
          className={cn(
            overdue
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-orange-200 bg-orange-50 text-orange-700",
          )}
        >
          {overdue ? "overdue — " : ""}{formatDate(deal.reengage_on)}
        </Badge>
        {canAct ? (
          <Button size="sm" variant={hot ? "default" : "outline"} disabled={pending} onClick={() => reopen(deal)}>
            {pending ? <Loader2 className="animate-spin" /> : <ArrowRight />}
            Re-open
          </Button>
        ) : null}
      </li>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Re-engage</h1>
        <p className="text-sm text-muted-foreground">
          Paused conversations scheduled to come back onto the radar.
        </p>
      </div>

      {deals.length === 0 ? (
        <EmptyState
          icon={RotateCcw}
          title="Nothing waiting to re-engage"
          description="Deals moved to Re-engage appear here when their date approaches."
        />
      ) : (
        <>
          {dueSoon.length ? (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-orange-600">
                Due now / within 14 days
              </h2>
              <ul className="space-y-2">{dueSoon.map((d) => row(d, true))}</ul>
            </div>
          ) : null}
          {later.length ? (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Scheduled later
              </h2>
              <ul className="space-y-2">{later.map((d) => row(d, false))}</ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
