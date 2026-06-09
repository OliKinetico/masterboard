"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListChecks, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChecklistStatusChip } from "@/components/chips";
import {
  CHECKLIST_ITEM_STATUSES, CHECKLIST_STATUS_META,
  RESPONSIBLES, RESPONSIBLE_LABELS,
} from "@/lib/domain";
import { setChecklistItem, addChecklistItem } from "@/server/actions/deal-children";
import { formatDate, isOverdue } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DealChecklist, DealChecklistItem } from "@/lib/types";

/** Generic checklist engine UI (spec §4.9) — DD pack etc. */
export function ChecklistsTab({
  dealId,
  checklists,
  canEdit,
}: {
  dealId: string;
  checklists: Array<DealChecklist & { deal_checklist_items: DealChecklistItem[] }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newTitles, setNewTitles] = useState<Record<string, string>>({});

  if (checklists.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No checklists on this deal"
        description="Checklists spawn automatically when a deal enters a template's trigger column — the Due Diligence Pack spawns on entering Due Diligence. Templates are editable in Admin."
      />
    );
  }

  function update(itemId: string, fields: Parameters<typeof setChecklistItem>[2]) {
    startTransition(async () => {
      const result = await setChecklistItem(dealId, itemId, fields);
      if (result.error) toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {checklists.map((checklist) => {
        const items = [...checklist.deal_checklist_items].sort((a, b) => a.sort - b.sort);
        const done = items.filter((i) => i.status === "done" || i.status === "n/a").length;
        return (
          <div key={checklist.id} className="rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <p className="text-sm font-semibold">{checklist.name}</p>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-all"
                    style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {done}/{items.length}
                </span>
              </div>
            </div>
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <span
                    className={cn(
                      "flex-1 min-w-44 text-sm",
                      (item.status === "done" || item.status === "n/a") &&
                        "text-muted-foreground line-through decoration-slate-300",
                    )}
                  >
                    {item.title}
                  </span>
                  {item.due_on ? (
                    <span className={cn("text-[11px]", isOverdue(item.due_on) && item.status !== "done" ? "font-medium text-red-600" : "text-muted-foreground")}>
                      due {formatDate(item.due_on)}
                    </span>
                  ) : null}
                  {canEdit ? (
                    <>
                      <Select
                        value={item.responsible}
                        onValueChange={(v) => update(item.id, { responsible: v })}
                      >
                        <SelectTrigger className="h-6 w-auto gap-1 border-none bg-slate-50 text-[11px]" disabled={pending}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RESPONSIBLES.map((r) => (
                            <SelectItem key={r} value={r}>{RESPONSIBLE_LABELS[r]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={item.status}
                        onValueChange={(v) => update(item.id, { status: v })}
                      >
                        <SelectTrigger className="h-6 w-auto gap-1 border-none bg-transparent p-0 text-[11px] shadow-none" disabled={pending}>
                          <ChecklistStatusChip status={item.status} />
                        </SelectTrigger>
                        <SelectContent>
                          {CHECKLIST_ITEM_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>{CHECKLIST_STATUS_META[s].label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <>
                      <span className="text-[11px] text-muted-foreground">{RESPONSIBLE_LABELS[item.responsible]}</span>
                      <ChecklistStatusChip status={item.status} />
                    </>
                  )}
                  {item.note ? (
                    <p className="w-full pl-0 text-xs text-muted-foreground">{item.note}</p>
                  ) : null}
                </li>
              ))}
            </ul>
            {canEdit ? (
              <div className="flex gap-1.5 border-t px-4 py-2">
                <Input
                  className="h-8 text-xs"
                  placeholder="Add an item…"
                  value={newTitles[checklist.id] ?? ""}
                  onChange={(e) =>
                    setNewTitles((t) => ({ ...t, [checklist.id]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    const title = newTitles[checklist.id]?.trim();
                    if (e.key === "Enter" && title) {
                      startTransition(async () => {
                        await addChecklistItem(dealId, checklist.id, title);
                        setNewTitles((t) => ({ ...t, [checklist.id]: "" }));
                        router.refresh();
                      });
                    }
                  }}
                />
                <Button
                  size="icon-sm"
                  variant="outline"
                  disabled={pending || !newTitles[checklist.id]?.trim()}
                  onClick={() => {
                    const title = newTitles[checklist.id]?.trim();
                    if (!title) return;
                    startTransition(async () => {
                      await addChecklistItem(dealId, checklist.id, title);
                      setNewTitles((t) => ({ ...t, [checklist.id]: "" }));
                      router.refresh();
                    });
                  }}
                  aria-label="Add checklist item"
                >
                  <Plus />
                </Button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
