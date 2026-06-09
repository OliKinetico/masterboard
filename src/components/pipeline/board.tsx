"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { Inbox } from "lucide-react";
import { COLUMN_META, PIPELINE_COLUMNS, type PipelineColumn } from "@/lib/domain";
import { formatGBPCompact } from "@/lib/format";
import { moveDeal } from "@/server/actions/deals";
import { cn } from "@/lib/utils";
import { DealCard } from "./deal-card";
import { MoveDialog } from "./move-dialog";
import type { PipelineDeal, ColumnSummary } from "./types";

const PAGE = 25;

export function Board({
  deals,
  summaries,
  isStaff,
}: {
  deals: PipelineDeal[];
  summaries: ColumnSummary[];
  isStaff: boolean;
}) {
  const router = useRouter();
  const [localDeals, setLocalDeals] = useState(deals);
  const [active, setActive] = useState<PipelineDeal | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    deal: PipelineDeal;
    to: PipelineColumn;
  } | null>(null);
  const [visible, setVisible] = useState<Record<string, number>>({});

  useEffect(() => setLocalDeals(deals), [deals]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const byColumn = useMemo(() => {
    const map = new Map<PipelineColumn, PipelineDeal[]>();
    for (const col of PIPELINE_COLUMNS) map.set(col, []);
    // most recent activity first — columns render top N (spec §5.1)
    for (const d of localDeals) map.get(d.pipeline_column)?.push(d);
    return map;
  }, [localDeals]);

  const summaryByColumn = useMemo(
    () => new Map(summaries.map((s) => [s.column, s])),
    [summaries],
  );

  function onDragStart(event: DragStartEvent) {
    setActive(localDeals.find((d) => d.id === event.active.id) ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setActive(null);
    const dealId = event.active.id as string;
    const to = event.over?.id as PipelineColumn | undefined;
    const deal = localDeals.find((d) => d.id === dealId);
    if (!deal || !to || deal.pipeline_column === to) return;

    if (to === "dead" || to === "reengage") {
      setPendingMove({ deal, to });
      return;
    }
    void commitMove(deal, to);
  }

  async function commitMove(
    deal: PipelineDeal,
    to: PipelineColumn,
    extras?: { deadReason?: string; reengageOn?: string },
  ) {
    const prev = localDeals;
    setLocalDeals((ds) =>
      ds.map((d) =>
        d.id === deal.id
          ? {
              ...d,
              pipeline_column: to,
              days_in_column: 0,
              tier: (["silver", "gold", "platinum"] as const).includes(
                to as never,
              )
                ? (to as PipelineDeal["tier"])
                : d.tier,
            }
          : d,
      ),
    );
    const result = await moveDeal({ dealId: deal.id, toColumn: to, ...extras });
    if (result.error) {
      setLocalDeals(prev);
      toast.error(result.error);
      return;
    }
    if (result.needsNextAction) {
      toast.warning(`${deal.name} needs a next action in ${COLUMN_META[to].label}`, {
        action: { label: "Set it", onClick: () => router.push(`/deals/${deal.id}`) },
        duration: 8000,
      });
    }
    router.refresh();
  }

  return (
    <>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex flex-1 gap-2.5 overflow-x-auto pb-2 thin-scroll">
          {PIPELINE_COLUMNS.map((column) => {
            const colDeals = byColumn.get(column) ?? [];
            const summary = summaryByColumn.get(column);
            const shown = visible[column] ?? PAGE;
            return (
              <Column
                key={column}
                column={column}
                count={summary?.count ?? colDeals.length}
                weighted={summary?.weightedValue ?? 0}
                draggable={isStaff}
              >
                {colDeals.slice(0, shown).map((deal) =>
                  isStaff ? (
                    <DraggableCard key={deal.id} deal={deal} />
                  ) : (
                    <DealCard key={deal.id} deal={deal} />
                  ),
                )}
                {colDeals.length > shown ? (
                  <button
                    className="w-full rounded-md border border-dashed py-1.5 text-xs text-muted-foreground hover:bg-slate-50 cursor-pointer"
                    onClick={() =>
                      setVisible((v) => ({ ...v, [column]: shown + PAGE }))
                    }
                  >
                    Show {Math.min(PAGE, colDeals.length - shown)} more
                  </button>
                ) : null}
                {colDeals.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 rounded-md border border-dashed py-6 text-center">
                    <Inbox className="h-4 w-4 text-slate-300" />
                    <p className="text-[11px] text-muted-foreground">No deals</p>
                  </div>
                ) : null}
              </Column>
            );
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {active ? (
            <div className="w-60">
              <DealCard deal={active} dragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <MoveDialog
        pending={pendingMove}
        onCancel={() => setPendingMove(null)}
        onConfirm={(extras) => {
          if (pendingMove) void commitMove(pendingMove.deal, pendingMove.to, extras);
          setPendingMove(null);
        }}
      />
    </>
  );
}

function Column({
  column,
  count,
  weighted,
  draggable,
  children,
}: {
  column: PipelineColumn;
  count: number;
  weighted: number;
  draggable: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column, disabled: !draggable });
  const meta = COLUMN_META[column];
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-60 shrink-0 flex-col rounded-lg border border-t-2 bg-slate-50/80 transition-colors",
        meta.header,
        isOver && "bg-brand-50/70 ring-2 ring-brand-300",
      )}
      data-testid={`column-${column}`}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-2">
        <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
        <span className="text-xs font-semibold">{meta.label}</span>
        <span className="text-xs text-muted-foreground">{count}</span>
        <span className="ml-auto text-[11px] font-medium text-muted-foreground" data-financial>
          {weighted > 0 ? formatGBPCompact(weighted) : ""}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2 thin-scroll">
        {children}
      </div>
    </div>
  );
}

function DraggableCard({ deal }: { deal: PipelineDeal }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn("touch-manipulation", isDragging && "opacity-40")}
    >
      <DealCard deal={deal} />
    </div>
  );
}
