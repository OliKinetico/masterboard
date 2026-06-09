"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, BookmarkPlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { TIER_COLUMNS, UK_REGIONS, DISCIPLINES, TIER_META } from "@/lib/domain";
import type { SavedView } from "@/lib/types";

const FILTER_KEYS = ["owner", "tier", "region", "disc", "score"] as const;

/** Filter bar + saved views (spec §5.1). State lives in the URL. */
export function FilterBar({
  profiles,
  currentUserId,
}: {
  profiles: Array<{ user_id: string; full_name: string }>;
  currentUserId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [views, setViews] = useState<SavedView[]>([]);

  useEffect(() => {
    createClient()
      .from("saved_views")
      .select("*")
      .eq("page", "pipeline")
      .order("name")
      .then(({ data }) => setViews((data as SavedView[]) ?? []));
  }, []);

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null || value === "" || value === "__all") params.delete(key);
    else params.set(key, value);
    router.replace(`${pathname}?${params.toString()}`);
  }

  async function saveCurrentView() {
    const name = window.prompt("Name this view:");
    if (!name?.trim()) return;
    const filters: Record<string, string> = {};
    for (const key of FILTER_KEYS) {
      const v = searchParams.get(key);
      if (v) filters[key] = v;
    }
    const { data, error } = await createClient()
      .from("saved_views")
      .upsert(
        { user_id: currentUserId, page: "pipeline", name: name.trim(), filters },
        { onConflict: "user_id,page,name" },
      )
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setViews((v) => [...v.filter((x) => x.id !== data.id), data as SavedView]);
    toast.success(`View “${name.trim()}” saved`);
  }

  function applyView(view: SavedView) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(view.filters)) {
      if (typeof v === "string" && v) params.set(k, v);
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  async function deleteView(view: SavedView) {
    await createClient().from("saved_views").delete().eq("id", view.id);
    setViews((v) => v.filter((x) => x.id !== view.id));
  }

  const owner = searchParams.get("owner") ?? "me";
  const hasFilters = FILTER_KEYS.some(
    (k) => searchParams.get(k) && !(k === "owner" && owner === "me"),
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={owner} onValueChange={(v) => setParam("owner", v === "me" ? null : v)}>
        <SelectTrigger className="h-8 w-auto gap-1.5 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="me">My deals</SelectItem>
          <SelectItem value="all">All owners</SelectItem>
          {profiles.map((p) => (
            <SelectItem key={p.user_id} value={p.user_id}>
              {p.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={searchParams.get("tier") ?? "__all"} onValueChange={(v) => setParam("tier", v)}>
        <SelectTrigger className="h-8 w-auto gap-1.5 text-xs">
          <SelectValue placeholder="Tier" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">Any tier</SelectItem>
          {TIER_COLUMNS.map((t) => (
            <SelectItem key={t} value={t}>{TIER_META[t].label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={searchParams.get("region") ?? "__all"} onValueChange={(v) => setParam("region", v)}>
        <SelectTrigger className="h-8 w-auto gap-1.5 text-xs">
          <SelectValue placeholder="Region" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All regions</SelectItem>
          {UK_REGIONS.map((r) => (
            <SelectItem key={r} value={r}>{r}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={searchParams.get("disc") ?? "__all"} onValueChange={(v) => setParam("disc", v)}>
        <SelectTrigger className="h-8 w-auto gap-1.5 text-xs">
          <SelectValue placeholder="Discipline" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All disciplines</SelectItem>
          {DISCIPLINES.map((d) => (
            <SelectItem key={d} value={d}>{d}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={searchParams.get("score") ?? "__all"} onValueChange={(v) => setParam("score", v)}>
        <SelectTrigger className="h-8 w-auto gap-1.5 text-xs">
          <SelectValue placeholder="Score" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">Any score</SelectItem>
          <SelectItem value="high">Score 75+</SelectItem>
          <SelectItem value="mid">Score 50–74</SelectItem>
          <SelectItem value="low">Score &lt; 50</SelectItem>
        </SelectContent>
      </Select>

      {hasFilters ? (
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => router.replace(pathname)}>
          <X /> Clear
        </Button>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs">
            <Bookmark /> Views
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          {views.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No saved views yet.
            </p>
          ) : (
            views.map((v) => (
              <DropdownMenuItem
                key={v.id}
                className="group justify-between"
                onClick={() => applyView(v)}
              >
                <span className="truncate">{v.name}</span>
                <button
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteView(v);
                  }}
                  aria-label={`Delete view ${v.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={saveCurrentView}>
            <BookmarkPlus /> Save current filters…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
