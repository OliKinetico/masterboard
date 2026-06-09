"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, Users, StickyNote, Loader2, Check, Search } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ColumnChip } from "@/components/chips";
import type { PipelineColumn } from "@/lib/domain";
import { quickLog } from "@/server/actions/interactions";
import { cn } from "@/lib/utils";

type LogType = "call" | "meeting" | "note";

interface DealHit {
  id: string;
  name: string;
  pipeline_column: PipelineColumn;
}

const TYPES: Array<{ value: LogType; label: string; icon: typeof Phone }> = [
  { value: "call", label: "Call", icon: Phone },
  { value: "meeting", label: "Meeting", icon: Users },
  { value: "note", label: "Note", icon: StickyNote },
];

/**
 * Quick-log (spec §5.3) — the highest-frequency interaction. Recent-first
 * deal picker, type, text, optional follow-up. Mobile-first: big tap
 * targets, one screen, ≤3 taps to save.
 */
export function QuickLog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deals, setDeals] = useState<DealHit[]>([]);
  const [dealQuery, setDealQuery] = useState("");
  const [deal, setDeal] = useState<DealHit | null>(null);
  const [type, setType] = useState<LogType>("call");
  const [text, setText] = useState("");
  const [withTask, setWithTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [pending, startTransition] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as { type?: string; dealId?: string };
      if (detail?.type === "note") setType("note");
      setOpen(true);
    }
    window.addEventListener("kinetico:quicklog", onOpen);
    return () => window.removeEventListener("kinetico:quicklog", onOpen);
  }, []);

  // recent-first deals on open; fuzzy search as the user types
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(dealQuery)}`);
      if (res.ok) {
        const json = await res.json();
        setDeals(json.deals ?? []);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [open, dealQuery]);

  function reset() {
    setDeal(null);
    setDealQuery("");
    setText("");
    setWithTask(false);
    setTaskTitle("");
    setTaskDue("");
    setType("call");
  }

  function save() {
    if (!deal) return;
    startTransition(async () => {
      const result = await quickLog({
        dealId: deal.id,
        type,
        text,
        followUpTitle: withTask ? taskTitle : null,
        followUpDue: withTask && taskDue ? taskDue : null,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${TYPES.find((t) => t.value === type)?.label} logged on ${deal.name}`);
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogContent className="max-w-md" data-testid="quick-log-dialog">
        <DialogHeader>
          <DialogTitle>Quick log</DialogTitle>
          <DialogDescription>
            {deal ? "What happened?" : "Pick a deal — recent first"}
          </DialogDescription>
        </DialogHeader>

        {!deal ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search deals…"
                className="pl-8"
                value={dealQuery}
                onChange={(e) => setDealQuery(e.target.value)}
              />
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {deals.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    setDeal(d);
                    setTimeout(() => textRef.current?.focus(), 50);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-left text-sm transition-colors hover:border-brand-300 hover:bg-brand-50 cursor-pointer"
                >
                  <span className="truncate font-medium">{d.name}</span>
                  <ColumnChip column={d.pipeline_column} />
                </button>
              ))}
              {deals.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No live deals match.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              onClick={() => setDeal(null)}
              className="flex w-full items-center justify-between gap-2 rounded-md bg-brand-50 px-3 py-2 text-sm cursor-pointer"
            >
              <span className="truncate font-medium text-brand-800">{deal.name}</span>
              <span className="text-xs text-brand-700">change</span>
            </button>

            <div className="grid grid-cols-3 gap-2">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setType(t.value)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border px-3 py-2.5 text-xs font-medium transition-colors cursor-pointer",
                    type === t.value
                      ? "border-brand-500 bg-brand-50 text-brand-800"
                      : "hover:bg-slate-50",
                  )}
                >
                  <t.icon className={cn("h-4 w-4", type === t.value ? "text-brand-600" : "text-slate-400")} />
                  {t.label}
                </button>
              ))}
            </div>

            <Textarea
              ref={textRef}
              placeholder={
                type === "note" ? "Note…" : `What was discussed on the ${type}?`
              }
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={withTask}
                  onCheckedChange={(v) => setWithTask(v === true)}
                />
                Add follow-up task
              </label>
              {withTask ? (
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <Input
                    placeholder="Task title"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                  />
                  <div>
                    <Label className="sr-only" htmlFor="task-due">Due</Label>
                    <Input
                      id="task-due"
                      type="date"
                      value={taskDue}
                      onChange={(e) => setTaskDue(e.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <Button
              className="w-full"
              disabled={pending || !text.trim()}
              onClick={save}
              data-testid="quick-log-save"
            >
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              Save
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
