"use client";

import Link from "next/link";
import { CalendarClock, Clock, Landmark } from "lucide-react";
import { TierChip } from "@/components/chips";
import { UserAvatar } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelativeDays, isOverdue } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PipelineDeal } from "./types";

export function DealCard({
  deal,
  dragging,
}: {
  deal: PipelineDeal;
  dragging?: boolean;
}) {
  return (
    <div
      className={cn(
        "group rounded-md border bg-card p-2.5 shadow-sm transition-shadow",
        dragging ? "rotate-1 shadow-lg ring-2 ring-brand-400" : "hover:shadow",
      )}
      data-testid={`deal-card-${deal.id}`}
    >
      <div className="flex items-start justify-between gap-1">
        <Link
          href={`/deals/${deal.id}`}
          className="line-clamp-2 text-[13px] font-medium leading-snug hover:text-brand-700 hover:underline"
          draggable={false}
        >
          {deal.name}
        </Link>
        {deal.owner_name ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <UserAvatar name={deal.owner_name} className="h-5 w-5 shrink-0" />
              </div>
            </TooltipTrigger>
            <TooltipContent>{deal.owner_name}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <TierChip tier={deal.tier} className="px-1.5 py-0 text-[10px]" />
        {deal.region ? (
          <span className="text-[11px] text-muted-foreground">{deal.region}</span>
        ) : null}
        {deal.has_ch_signal ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                <Landmark className="h-3 w-3" /> CH
              </span>
            </TooltipTrigger>
            <TooltipContent>New Companies House signal</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        {deal.next_action_due ? (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              isOverdue(deal.next_action_due) && "font-medium text-red-600",
            )}
          >
            <CalendarClock className="h-3 w-3" />
            {formatRelativeDays(deal.next_action_due)}
          </span>
        ) : (
          <span />
        )}
        {deal.days_in_column !== null ? (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {deal.days_in_column}d
          </span>
        ) : null}
      </div>
    </div>
  );
}
