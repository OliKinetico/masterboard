"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Building2,
  Users,
  Phone,
  Plus,
  Scale,
  BarChart3,
  KanbanSquare,
  Inbox,
  RotateCcw,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { ColumnChip } from "@/components/chips";
import type { PipelineColumn } from "@/lib/domain";
import { openQuickLog } from "./bus";

interface SearchResults {
  deals: Array<{ id: string; name: string; pipeline_column: PipelineColumn }>;
  clinics: Array<{ id: string; name: string; city: string | null; postcode: string | null }>;
  contacts: Array<{ id: string; full_name: string; role: string }>;
}

const ACTIONS = [
  { label: "Log a call", icon: Phone, run: (go: (p: string) => void) => { void go; openQuickLog("call"); } },
  { label: "New deal", icon: Plus, run: (go: (p: string) => void) => go("/deals?new=1") },
  { label: "Go to Pipeline", icon: KanbanSquare, run: (go: (p: string) => void) => go("/") },
  { label: "Go to Legal Board", icon: Scale, run: (go: (p: string) => void) => go("/legal-board") },
  { label: "Go to Analytics", icon: BarChart3, run: (go: (p: string) => void) => go("/analytics") },
  { label: "Go to Unmatched Inbox", icon: Inbox, run: (go: (p: string) => void) => go("/unmatched") },
  { label: "Go to Re-engage", icon: RotateCcw, run: (go: (p: string) => void) => go("/reengage") },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("kinetico:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("kinetico:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (res.ok) setResults(await res.json());
      } catch {
        /* aborted */
      }
    }, 140);
    return () => clearTimeout(t);
  }, [query, open]);

  const go = useCallback(
    (path: string) => {
      setOpen(false);
      setQuery("");
      router.push(path);
    },
    [router],
  );

  const filteredActions = query
    ? ACTIONS.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()))
    : ACTIONS;

  const hasRecords =
    (results?.deals.length ?? 0) +
      (results?.clinics.length ?? 0) +
      (results?.contacts.length ?? 0) >
    0;

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search deals, clinics, contacts — or type a command…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {!hasRecords && filteredActions.length === 0 ? (
          <CommandEmpty>No results for “{query}”.</CommandEmpty>
        ) : null}

        {results?.deals.length ? (
          <CommandGroup heading="Deals">
            {results.deals.map((d) => (
              <CommandItem key={d.id} value={`deal-${d.id}`} onSelect={() => go(`/deals/${d.id}`)}>
                <Briefcase className="text-slate-400" />
                <span className="flex-1 truncate">{d.name}</span>
                <ColumnChip column={d.pipeline_column} />
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {results?.clinics.length ? (
          <CommandGroup heading="Clinics">
            {results.clinics.map((c) => (
              <CommandItem key={c.id} value={`clinic-${c.id}`} onSelect={() => go(`/clinics/${c.id}`)}>
                <Building2 className="text-slate-400" />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-xs text-muted-foreground">
                  {[c.city, c.postcode].filter(Boolean).join(" · ")}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {results?.contacts.length ? (
          <CommandGroup heading="Contacts">
            {results.contacts.map((c) => (
              <CommandItem key={c.id} value={`contact-${c.id}`} onSelect={() => go(`/contacts/${c.id}`)}>
                <Users className="text-slate-400" />
                <span className="flex-1 truncate">{c.full_name}</span>
                <span className="text-xs capitalize text-muted-foreground">
                  {c.role.replace("_", " ")}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {filteredActions.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              {filteredActions.map((a) => (
                <CommandItem key={a.label} value={`action-${a.label}`} onSelect={() => { setOpen(false); a.run(go); }}>
                  <a.icon className="text-brand-600" />
                  {a.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
