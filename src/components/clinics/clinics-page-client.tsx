"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, ChevronLeft, ChevronRight, Download, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ClinicDialog } from "./clinic-dialog";
import { toCsv, downloadCsv } from "@/lib/csv";
import { formatGBP } from "@/lib/format";
import { DISCIPLINES, UK_REGIONS } from "@/lib/domain";
import type { Clinic } from "@/lib/types";

export function ClinicsPageClient({
  clinics,
  total,
  page,
  pageSize,
  canCreate,
}: {
  clinics: Clinic[];
  total: number;
  page: number;
  pageSize: number;
  canCreate: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const newOpen = searchParams.get("new") === "1";

  function apply(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value) params.delete(key);
    else params.set(key, value);
    if (key !== "page") params.delete("page");
    router.replace(`${pathname}?${params.toString()}`);
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Clinics</h1>
        <span className="text-xs text-muted-foreground">{total} total</span>
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            apply("q", q.trim() || null);
          }}
        >
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 w-60 pl-8" placeholder="Name, postcode, city, CH number…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <Select value={searchParams.get("region") ?? "__all"} onValueChange={(v) => apply("region", v === "__all" ? null : v)}>
          <SelectTrigger className="h-9 w-auto gap-1.5 text-xs"><SelectValue placeholder="Region" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All regions</SelectItem>
            {UK_REGIONS.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={searchParams.get("disc") ?? "__all"} onValueChange={(v) => apply("disc", v === "__all" ? null : v)}>
          <SelectTrigger className="h-9 w-auto gap-1.5 text-xs"><SelectValue placeholder="Discipline" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All disciplines</SelectItem>
            {DISCIPLINES.map((d) => (<SelectItem key={d} value={d}>{d}</SelectItem>))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCsv(
                `clinics-${new Date().toISOString().slice(0, 10)}.csv`,
                toCsv(
                  ["Name", "City", "Postcode", "Region", "Disciplines", "Revenue", "Practitioners", "Sites", "Score", "CH number", "Source"],
                  clinics.map((c) => [
                    c.name, c.city, c.postcode, c.region, c.disciplines,
                    c.revenue_estimate, c.practitioner_count, c.sites_count,
                    c.score, c.companies_house_number, c.source,
                  ]),
                ),
              )
            }
          >
            <Download /> CSV
          </Button>
          {canCreate ? (
            <Button size="sm" onClick={() => apply("new", "1")}>
              <Plus /> New clinic
            </Button>
          ) : null}
        </div>
      </div>

      {clinics.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No clinics match"
          description="Adjust the search or filters — or import a clinic list via Admin → Imports."
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Disciplines</TableHead>
                <TableHead className="text-right">Revenue est.</TableHead>
                <TableHead className="text-right">Practitioners</TableHead>
                <TableHead className="text-right">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clinics.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/clinics/${c.id}`} className="font-medium hover:text-brand-700 hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {[c.city, c.postcode].filter(Boolean).join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.region ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.disciplines.map((d) => (
                        <Badge key={d} variant="secondary" className="text-[10px]">{d}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right" data-financial>{formatGBP(c.revenue_estimate)}</TableCell>
                  <TableCell className="text-right">{c.practitioner_count ?? "—"}</TableCell>
                  <TableCell className="text-right">{c.score ? Number(c.score).toFixed(0) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          Page {page} of {pages}
          <Button variant="outline" size="icon-sm" disabled={page <= 1}
            onClick={() => apply("page", String(page - 1))} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={page >= pages}
            onClick={() => apply("page", String(page + 1))} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      ) : null}

      <ClinicDialog open={newOpen} onClose={() => apply("new", null)} initial={null} />
    </div>
  );
}
