"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { createDeal } from "@/server/actions/deals";

interface ClinicHit {
  id: string;
  name: string;
  city: string | null;
  postcode: string | null;
}

/** New deal: pick a primary clinic (+ extra sites for group deals). */
export function NewDealDialog() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = searchParams.get("new") === "1";

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ClinicHit[]>([]);
  const [selected, setSelected] = useState<ClinicHit[]>([]);
  const [name, setName] = useState("");
  const [firstMetOn, setFirstMetOn] = useState("");
  const [firstMetContext, setFirstMetContext] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const json = await res.json();
        setHits(json.clinics ?? []);
      }
    }, 130);
    return () => clearTimeout(t);
  }, [query, open]);

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`);
    setSelected([]);
    setName("");
    setQuery("");
    setFirstMetOn("");
    setFirstMetContext("");
  }

  function addClinic(clinic: ClinicHit) {
    if (selected.some((c) => c.id === clinic.id)) return;
    const next = [...selected, clinic];
    setSelected(next);
    if (!name || name === selected[0]?.name) {
      setName(next.length > 1 ? `${next[0].name.split("—")[0].trim()} Group` : clinic.name);
    }
    setQuery("");
  }

  function submit() {
    if (!selected.length || !name.trim()) {
      toast.error("Pick at least one clinic and a deal name");
      return;
    }
    startTransition(async () => {
      const result = await createDeal({
        name,
        primaryClinicId: selected[0].id,
        extraClinicIds: selected.slice(1).map((c) => c.id),
        firstMetOn: firstMetOn || null,
        firstMetContext: firstMetContext || null,
      });
      if (result.error) {
        toast.error(result.error);
        if (result.dealId) router.push(`/deals/${result.dealId}`);
        return;
      }
      toast.success("Deal created in Identified");
      router.push(`/deals/${result.dealId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New deal</DialogTitle>
          <DialogDescription>
            Starts in Identified. Add several clinics for a multi-site group —
            a clinic can only sit on one live deal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {selected.length ? (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((c, i) => (
                <Badge key={c.id} variant="outline" className="gap-1 py-1">
                  {i === 0 ? <span className="text-[9px] font-bold uppercase text-brand-600">primary</span> : null}
                  {c.name}
                  <button onClick={() => setSelected((s) => s.filter((x) => x.id !== c.id))} aria-label={`Remove ${c.name}`}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : null}

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search clinics to add…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          {query && hits.length ? (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-1">
              {hits.map((c) => (
                <button
                  key={c.id}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-brand-50 cursor-pointer"
                  onClick={() => addClinic(c)}
                >
                  <span>{c.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {[c.city, c.postcode].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="space-y-1">
            <Label>Deal name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to clinic / group name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>First met</Label>
              <Input type="date" value={firstMetOn} onChange={(e) => setFirstMetOn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Context</Label>
              <Input placeholder="e.g. Therapy Expo intro" value={firstMetContext} onChange={(e) => setFirstMetContext(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !selected.length}>Create deal</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
