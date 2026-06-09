"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, Plus, Search, Users } from "lucide-react";
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
import { ContactDialog } from "./contact-dialog";
import { toCsv, downloadCsv } from "@/lib/csv";
import { CONTACT_ROLES, CONTACT_ROLE_LABELS } from "@/lib/domain";
import type { Contact } from "@/lib/types";

type ContactWithClinic = Contact & { clinics: { id: string; name: string } | null };

export function ContactsPageClient({
  contacts,
  clinics,
  total,
  page,
  pageSize,
  canCreate,
}: {
  contacts: ContactWithClinic[];
  clinics: Array<{ id: string; name: string }>;
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
        <h1 className="text-lg font-semibold tracking-tight">Contacts</h1>
        <span className="text-xs text-muted-foreground">{total} total</span>
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            apply("q", q.trim() || null);
          }}
        >
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 w-56 pl-8" placeholder="Search names…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <Select value={searchParams.get("role") ?? "__all"} onValueChange={(v) => apply("role", v === "__all" ? null : v)}>
          <SelectTrigger className="h-9 w-auto gap-1.5 text-xs"><SelectValue placeholder="Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All roles</SelectItem>
            {CONTACT_ROLES.map((r) => (<SelectItem key={r} value={r}>{CONTACT_ROLE_LABELS[r]}</SelectItem>))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-1.5">
          <Button
            variant="outline" size="sm"
            onClick={() =>
              downloadCsv(
                `contacts-${new Date().toISOString().slice(0, 10)}.csv`,
                toCsv(
                  ["Name", "Role", "Clinic", "Emails", "Phone", "WhatsApp"],
                  contacts.map((c) => [
                    c.full_name, CONTACT_ROLE_LABELS[c.role], c.clinics?.name ?? "",
                    c.emails, c.phone ?? "", c.whatsapp_number ?? "",
                  ]),
                ),
              )
            }
          >
            <Download /> CSV
          </Button>
          {canCreate ? (
            <Button size="sm" onClick={() => apply("new", "1")}>
              <Plus /> New contact
            </Button>
          ) : null}
        </div>
      </div>

      {contacts.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No contacts match"
          description="Contacts are created here, from deal pages, or automatically from the Unmatched Inbox."
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Clinic</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>WhatsApp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/contacts/${c.id}`} className="font-medium hover:text-brand-700 hover:underline">
                      {c.full_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">{CONTACT_ROLE_LABELS[c.role]}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.clinics ? (
                      <Link href={`/clinics/${c.clinics.id}`} className="hover:text-brand-700 hover:underline">
                        {c.clinics.name}
                      </Link>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.emails[0] ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.phone ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.whatsapp_number ?? "—"}</TableCell>
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
            onClick={() => apply("page", String(page - 1))} aria-label="Previous page"><ChevronLeft /></Button>
          <Button variant="outline" size="icon-sm" disabled={page >= pages}
            onClick={() => apply("page", String(page + 1))} aria-label="Next page"><ChevronRight /></Button>
        </div>
      ) : null}

      <ContactDialog open={newOpen} onClose={() => apply("new", null)} initial={null} clinics={clinics} />
    </div>
  );
}
