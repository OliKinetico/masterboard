"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List as ListIcon, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toCsv, downloadCsv } from "@/lib/csv";
import { COLUMN_META } from "@/lib/domain";
import { FilterBar } from "./filter-bar";
import { Board } from "./board";
import { ListView } from "./list-view";
import type { PipelineDeal, ColumnSummary } from "./types";

export function PipelineView({
  deals,
  summaries,
  profiles,
  currentUserId,
  isStaff,
}: {
  deals: PipelineDeal[];
  summaries: ColumnSummary[];
  profiles: Array<{ user_id: string; full_name: string }>;
  currentUserId: string;
  isStaff: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "list" ? "list" : "board";
  const [exporting, setExporting] = useState(false);

  const csvRows = useMemo(
    () =>
      deals.map((d) => [
        d.name,
        COLUMN_META[d.pipeline_column].label,
        d.tier ?? "",
        d.owner_name ?? "",
        d.region ?? "",
        d.disciplines.join("; "),
        d.score ?? "",
        d.revenue_estimate ?? "",
        d.latest_offer_ev ?? "",
        d.next_action ?? "",
        d.next_action_due ?? "",
        d.days_in_column ?? "",
      ]),
    [deals],
  );

  function exportCsv() {
    setExporting(true);
    downloadCsv(
      `pipeline-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ["Deal", "Column", "Tier", "Owner", "Region", "Disciplines", "Score",
          "Revenue estimate", "Latest offer EV", "Next action", "Next action due", "Days in column"],
        csvRows,
      ),
    );
    setExporting(false);
  }

  function setView(v: "board" | "list") {
    const params = new URLSearchParams(searchParams.toString());
    if (v === "list") params.set("view", "list");
    else params.delete("view");
    router.replace(`/?${params.toString()}`);
  }

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold tracking-tight">Pipeline</h1>
        <FilterBar profiles={profiles} currentUserId={currentUserId} />
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
            <Download /> CSV
          </Button>
          <div className="flex rounded-md border bg-card p-0.5">
            <button
              onClick={() => setView("board")}
              className={`flex h-7 w-8 items-center justify-center rounded cursor-pointer ${view === "board" ? "bg-brand-50 text-brand-700" : "text-slate-400 hover:text-slate-600"}`}
              aria-label="Board view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView("list")}
              className={`flex h-7 w-8 items-center justify-center rounded cursor-pointer ${view === "list" ? "bg-brand-50 text-brand-700" : "text-slate-400 hover:text-slate-600"}`}
              aria-label="List view"
            >
              <ListIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {view === "board" ? (
        <Board deals={deals} summaries={summaries} isStaff={isStaff} />
      ) : (
        <ListView deals={deals} />
      )}
    </div>
  );
}
