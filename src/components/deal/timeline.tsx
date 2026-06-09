"use client";

import { useMemo, useState } from "react";
import {
  Mail,
  MessageCircle,
  Phone,
  Users,
  StickyNote,
  ChevronDown,
  ChevronUp,
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  History,
  Loader2,
  MessagesSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { openQuickLog } from "@/components/shell/bus";
import {
  INTERACTION_TYPE_LABELS,
  INTERACTION_TYPES,
  COLUMN_META,
  type InteractionType,
} from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Contact, Interaction, StageHistory } from "@/lib/types";

const TYPE_ICONS: Record<InteractionType, typeof Mail> = {
  email: Mail,
  whatsapp_day: MessageCircle,
  call: Phone,
  meeting: Users,
  note: StickyNote,
};

const TYPE_COLORS: Record<InteractionType, string> = {
  email: "bg-blue-50 text-blue-600",
  whatsapp_day: "bg-green-50 text-green-600",
  call: "bg-violet-50 text-violet-600",
  meeting: "bg-amber-50 text-amber-600",
  note: "bg-slate-100 text-slate-500",
};

/** Unified timeline (spec §5.4): reverse-chron, type-filterable, expandable. */
export function Timeline({
  dealId,
  initial,
  contacts,
  stageHistory,
  canLog,
}: {
  dealId: string;
  initial: Interaction[];
  contacts: Contact[];
  stageHistory: StageHistory[];
  canLog: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<InteractionType | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(initial.length < 60);

  const contactById = useMemo(
    () => new Map(contacts.map((c) => [c.id, c])),
    [contacts],
  );

  const visible = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.type === filter)),
    [items, filter],
  );

  async function loadMore() {
    setLoadingMore(true);
    try {
      const last = items[items.length - 1];
      const res = await fetch(
        `/api/deals/${dealId}/interactions?before=${encodeURIComponent(last?.occurred_on ?? "")}&beforeId=${last?.id ?? ""}`,
      );
      if (res.ok) {
        const next: Interaction[] = await res.json();
        if (next.length < 60) setExhausted(true);
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...next.filter((n) => !seen.has(n.id))];
        });
      }
    } finally {
      setLoadingMore(false);
    }
  }

  function toggle(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </FilterChip>
        {INTERACTION_TYPES.map((t) => (
          <FilterChip key={t} active={filter === t} onClick={() => setFilter(t)}>
            {INTERACTION_TYPE_LABELS[t]}
          </FilterChip>
        ))}
        {canLog ? (
          <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => openQuickLog()}>
            Log something
          </Button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title={filter === "all" ? "Nothing on the timeline yet" : `No ${INTERACTION_TYPE_LABELS[filter as InteractionType]} entries`}
          description="Calls, meetings, notes, synced emails and WhatsApp imports all land here."
          action={canLog ? <Button size="sm" onClick={() => openQuickLog()}>Log the first interaction</Button> : undefined}
        />
      ) : (
        <ol className="relative space-y-2 border-l border-slate-200 pl-5">
          {visible.map((item) => {
            const Icon = TYPE_ICONS[item.type];
            const isOpen = expanded.has(item.id);
            const contact = item.contact_id ? contactById.get(item.contact_id) : null;
            const expandable = !!item.body;
            return (
              <li key={item.id} className="relative">
                <span
                  className={cn(
                    "absolute -left-[1.85rem] top-1 flex h-6 w-6 items-center justify-center rounded-full",
                    TYPE_COLORS[item.type],
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="rounded-md border bg-card px-3 py-2">
                  <div
                    className={cn("flex items-start gap-2", expandable && "cursor-pointer")}
                    onClick={() => expandable && toggle(item.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        {item.direction ? (
                          item.direction === "inbound" ? (
                            <ArrowDownLeft className="mr-1 inline h-3 w-3 text-blue-500" />
                          ) : (
                            <ArrowUpRight className="mr-1 inline h-3 w-3 text-slate-400" />
                          )
                        ) : null}
                        <span className="font-medium">{item.summary}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatDate(item.occurred_on)}
                        {contact ? ` · ${contact.full_name}` : ""}
                        {item.source !== "manual" ? ` · ${item.source.replace("_", " ")}` : ""}
                      </p>
                    </div>
                    {item.type === "email" && item.source === "outlook_sync" ? (
                      <a
                        href={`https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(item.source_ref ?? "")}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-400 hover:text-brand-600"
                        onClick={(e) => e.stopPropagation()}
                        title="Open in Outlook"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    {expandable ? (
                      <button className="text-slate-400" aria-label={isOpen ? "Collapse" : "Expand"}>
                        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    ) : null}
                  </div>
                  {isOpen && item.body ? (
                    <div className="mt-2 whitespace-pre-wrap rounded bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
                      {item.body}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {!exhausted && filter === "all" ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="animate-spin" /> : null}
            Load older entries
          </Button>
        </div>
      ) : null}

      {stageHistory.length ? (
        <details className="rounded-md border bg-card px-3 py-2">
          <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Stage history ({stageHistory.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {stageHistory.map((h) => (
              <li key={h.id} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 text-muted-foreground">{formatDate(h.moved_at)}</span>
                {h.from_column ? (
                  <>
                    <Badge variant="outline" className={COLUMN_META[h.from_column].chip}>
                      {COLUMN_META[h.from_column].label}
                    </Badge>
                    <span className="text-slate-400">→</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">created in</span>
                )}
                <Badge variant="outline" className={COLUMN_META[h.to_column].chip}>
                  {COLUMN_META[h.to_column].label}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
        active
          ? "border-brand-300 bg-brand-50 text-brand-800"
          : "bg-card text-muted-foreground hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}
