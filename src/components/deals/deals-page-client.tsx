"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ListView } from "@/components/pipeline/list-view";
import { NewDealDialog } from "./new-deal-dialog";
import { toCsv, downloadCsv } from "@/lib/csv";
import { COLUMN_META } from "@/lib/domain";
import type { PipelineDeal } from "@/components/pipeline/types";

export function DealsPageClient({
  deals,
  canCreate,
}: {
  deals: PipelineDeal[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");

  function apply(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    router.replace(`${pathname}?${params.toString()}`);
  }

  function exportCsv() {
    downloadCsv(
      `deals-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ["Deal", "Column", "Tier", "Owner", "Region", "Revenue", "Latest EV", "Next action", "Due"],
        deals.map((d) => [
          d.name, COLUMN_META[d.pipeline_column].label, d.tier ?? "", d.owner_name ?? "",
          d.region ?? "", d.revenue_estimate ?? "", d.latest_offer_ev ?? "",
          d.next_action ?? "", d.next_action_due ?? "",
        ]),
      ),
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Deals</h1>
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            apply("q", q.trim() || null);
          }}
        >
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="h-9 w-56 pl-8"
            placeholder="Search deals…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>
        <Select
          value={searchParams.get("status") ?? "all"}
          onValueChange={(v) => apply("status", v === "all" ? null : v)}
        >
          <SelectTrigger className="h-9 w-auto gap-1.5 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All deals</SelectItem>
            <SelectItem value="live">Live only</SelectItem>
            <SelectItem value="closed">Complete / dead</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-1.5">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download /> CSV
          </Button>
          {canCreate ? (
            <Button size="sm" onClick={() => apply("new", "1")} data-testid="new-deal">
              <Plus /> New deal
            </Button>
          ) : null}
        </div>
      </div>

      <ListView deals={deals} />
      <NewDealDialog />
    </div>
  );
}
