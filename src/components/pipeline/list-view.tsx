"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, SearchX } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ColumnChip, TierChip } from "@/components/chips";
import { EmptyState } from "@/components/ui/empty-state";
import { formatGBP, formatDate, isOverdue } from "@/lib/format";
import { PIPELINE_COLUMNS } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { PipelineDeal } from "./types";

type SortKey =
  | "name"
  | "column"
  | "tier"
  | "owner"
  | "region"
  | "revenue"
  | "ev"
  | "due"
  | "days";

/** List-view toggle of the pipeline (spec §5.1): sortable, CSV via parent. */
export function ListView({ deals }: { deals: PipelineDeal[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("column");
  const [asc, setAsc] = useState(true);

  const sorted = useMemo(() => {
    const colOrder = new Map(PIPELINE_COLUMNS.map((c, i) => [c, i]));
    const list = [...deals].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "column": cmp = (colOrder.get(a.pipeline_column) ?? 0) - (colOrder.get(b.pipeline_column) ?? 0); break;
        case "tier": cmp = (a.tier ?? "").localeCompare(b.tier ?? ""); break;
        case "owner": cmp = (a.owner_name ?? "").localeCompare(b.owner_name ?? ""); break;
        case "region": cmp = (a.region ?? "").localeCompare(b.region ?? ""); break;
        case "revenue": cmp = (a.revenue_estimate ?? 0) - (b.revenue_estimate ?? 0); break;
        case "ev": cmp = (a.latest_offer_ev ?? 0) - (b.latest_offer_ev ?? 0); break;
        case "due": cmp = (a.next_action_due ?? "9999").localeCompare(b.next_action_due ?? "9999"); break;
        case "days": cmp = (a.days_in_column ?? 0) - (b.days_in_column ?? 0); break;
      }
      return asc ? cmp : -cmp;
    });
    return list;
  }, [deals, sortKey, asc]);

  function header(label: string, key: SortKey, financial = false) {
    return (
      <TableHead className={cn(financial && "text-right")}>
        <button
          className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
          onClick={() => {
            if (sortKey === key) setAsc(!asc);
            else { setSortKey(key); setAsc(true); }
          }}
        >
          {label}
          <ArrowUpDown className={cn("h-3 w-3", sortKey === key ? "text-brand-600" : "opacity-40")} />
        </button>
      </TableHead>
    );
  }

  if (deals.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="No deals match these filters"
        description="Try widening the owner, tier or region filters — or clear them all."
      />
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {header("Deal", "name")}
            {header("Column", "column")}
            {header("Tier", "tier")}
            {header("Owner", "owner")}
            {header("Region", "region")}
            {header("Revenue", "revenue", true)}
            {header("Latest EV", "ev", true)}
            {header("Next action due", "due")}
            {header("Days in column", "days")}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((d) => (
            <TableRow key={d.id}>
              <TableCell>
                <Link href={`/deals/${d.id}`} className="font-medium hover:text-brand-700 hover:underline">
                  {d.name}
                </Link>
              </TableCell>
              <TableCell><ColumnChip column={d.pipeline_column} /></TableCell>
              <TableCell><TierChip tier={d.tier} /></TableCell>
              <TableCell className="text-muted-foreground">{d.owner_name ?? "—"}</TableCell>
              <TableCell className="text-muted-foreground">{d.region ?? "—"}</TableCell>
              <TableCell className="text-right" data-financial>{formatGBP(d.revenue_estimate)}</TableCell>
              <TableCell className="text-right" data-financial>{formatGBP(d.latest_offer_ev)}</TableCell>
              <TableCell className={cn(isOverdue(d.next_action_due) && "font-medium text-red-600")}>
                {formatDate(d.next_action_due)}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {d.days_in_column !== null ? `${d.days_in_column}d` : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
