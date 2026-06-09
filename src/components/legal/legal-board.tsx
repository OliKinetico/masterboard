"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpDown, Download, Scale } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { DocStatusChip } from "@/components/chips";
import { DOC_TYPE_ICONS } from "@/components/deal/doc-card";
import {
  DOC_STATUSES, DOC_STATUS_META, DOC_TYPE_LABELS, RESPONSIBLE_LABELS,
} from "@/lib/domain";
import { formatDate, isOverdue } from "@/lib/format";
import { setDocumentStatus } from "@/server/actions/deal-children";
import { toCsv, downloadCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import type { DocumentRow } from "@/lib/types";

export interface LegalBoardRow {
  doc: DocumentRow;
  dealId: string;
  dealName: string;
  staleDays: number;
}

type SortKey = "due" | "stale" | "deal" | "status";

/**
 * Cross-deal Legal Board (spec §5.6): the "what do I chase today" view.
 * Default sort: most stale first.
 */
export function LegalBoard({
  rows,
  canEdit,
}: {
  rows: LegalBoardRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sortKey, setSortKey] = useState<SortKey>("stale");
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    const list = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "due":
          cmp = (a.doc.due_on ?? "9999").localeCompare(b.doc.due_on ?? "9999");
          break;
        case "stale":
          cmp = a.staleDays - b.staleDays;
          break;
        case "deal":
          cmp = a.dealName.localeCompare(b.dealName);
          break;
        case "status":
          cmp = DOC_STATUSES.indexOf(a.doc.status) - DOC_STATUSES.indexOf(b.doc.status);
          break;
      }
      return asc ? cmp : -cmp;
    });
    return list;
  }, [rows, sortKey, asc]);

  function header(label: string, key: SortKey) {
    return (
      <TableHead>
        <button
          className="inline-flex items-center gap-1 hover:text-foreground cursor-pointer"
          onClick={() => {
            if (sortKey === key) setAsc(!asc);
            else { setSortKey(key); setAsc(key === "due"); }
          }}
        >
          {label}
          <ArrowUpDown className={cn("h-3 w-3", sortKey === key ? "text-brand-600" : "opacity-40")} />
        </button>
      </TableHead>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Legal Board</h1>
        <span className="text-xs text-muted-foreground">
          {rows.length} outstanding documents across live post-HoTs deals
        </span>
        <Button
          variant="outline" size="sm" className="ml-auto"
          onClick={() =>
            downloadCsv(
              `legal-board-${new Date().toISOString().slice(0, 10)}.csv`,
              toCsv(
                ["Deal", "Document", "Type", "Status", "Responsible", "Due", "Days since last change"],
                sorted.map((r) => [
                  r.dealName, r.doc.title, DOC_TYPE_LABELS[r.doc.doc_type],
                  DOC_STATUS_META[r.doc.status].label, RESPONSIBLE_LABELS[r.doc.responsible],
                  r.doc.due_on ?? "", r.staleDays,
                ]),
              ),
            )
          }
        >
          <Download /> CSV
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="Nothing to chase"
          description="When a live deal signs Heads of Terms, every unsigned legal document appears here, sorted by staleness."
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {header("Deal", "deal")}
                <TableHead>Document</TableHead>
                {header("Status", "status")}
                <TableHead>Responsible</TableHead>
                {header("Due", "due")}
                {header("Stale", "stale")}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => {
                const TypeIcon = DOC_TYPE_ICONS[row.doc.doc_type];
                return (
                  <TableRow key={row.doc.id}>
                    <TableCell>
                      <Link href={`/deals/${row.dealId}`} className="font-medium hover:text-brand-700 hover:underline">
                        {row.dealName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <TypeIcon className="h-3.5 w-3.5 text-slate-400" />
                        {row.doc.title}
                        {row.doc.version_label ? (
                          <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-semibold text-slate-600">
                            {row.doc.version_label}
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Select
                          value={row.doc.status}
                          onValueChange={(v) =>
                            startTransition(async () => {
                              const r = await setDocumentStatus(row.dealId, row.doc.id, v);
                              if (r.error) toast.error(r.error);
                              router.refresh();
                            })
                          }
                        >
                          <SelectTrigger
                            className="h-7 w-auto gap-1 border-none bg-transparent p-0 shadow-none"
                            disabled={pending}
                            aria-label={`Status of ${row.doc.title}`}
                          >
                            <DocStatusChip status={row.doc.status} />
                          </SelectTrigger>
                          <SelectContent>
                            {DOC_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>{DOC_STATUS_META[s].label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <DocStatusChip status={row.doc.status} />
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {RESPONSIBLE_LABELS[row.doc.responsible]}
                    </TableCell>
                    <TableCell className={cn(isOverdue(row.doc.due_on) && "font-medium text-red-600")}>
                      {formatDate(row.doc.due_on)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "font-medium",
                          row.staleDays > 14
                            ? "text-red-600"
                            : row.staleDays > 7
                              ? "text-amber-600"
                              : "text-muted-foreground",
                        )}
                      >
                        {row.staleDays}d
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
