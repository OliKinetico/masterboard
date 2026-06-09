import { notFound } from "next/navigation";
import Link from "next/link";
import { Landmark, Globe, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isStaff } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ColumnChip } from "@/components/chips";
import { UserAvatar } from "@/components/ui/avatar";
import { formatGBP, formatDate } from "@/lib/format";
import { CONTACT_ROLE_LABELS } from "@/lib/domain";
import type { ChSignal, Clinic, Contact } from "@/lib/types";
import { ClinicEditButton } from "@/components/clinics/clinic-edit-button";

export const dynamic = "force-dynamic";

export default async function ClinicDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const { data: clinic } = await supabase
    .from("clinics")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!clinic) notFound();

  const [{ data: contacts }, { data: dealLinks }, { data: signals }, { data: aliases }] =
    await Promise.all([
      supabase.from("contacts").select("*").eq("clinic_id", id).is("merged_into_contact_id", null).order("full_name"),
      supabase
        .from("deal_clinics")
        .select("deal_id, deals(id, name, pipeline_column, tier, is_live)")
        .eq("clinic_id", id),
      supabase.from("ch_signals").select("*").eq("clinic_id", id).order("seen_on", { ascending: false }),
      supabase.from("clinic_aliases").select("id, alias").eq("clinic_id", id).order("alias"),
    ]);

  const c = clinic as Clinic;
  const deals = ((dealLinks ?? []) as unknown as Array<{
    deals: { id: string; name: string; pipeline_column: string; is_live: boolean } | null;
  }>)
    .map((d) => d.deals)
    .filter((d): d is NonNullable<typeof d> => !!d);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{c.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {[c.address_line1, c.city, c.postcode, c.region].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {c.disciplines.map((d) => (
                <Badge key={d} variant="secondary">{d}</Badge>
              ))}
              <Badge variant="outline" className="text-muted-foreground">
                source: {c.source.replace("_", " ")}
              </Badge>
              {c.merged_into_clinic_id ? (
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                  merged
                </Badge>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {c.website ? (
                <a className="inline-flex items-center gap-1 hover:text-brand-700" href={c.website} target="_blank" rel="noreferrer">
                  <Globe className="h-3 w-3" /> {c.website.replace("https://", "")}
                </a>
              ) : null}
              {c.phone ? (
                <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {c.phone}</span>
              ) : null}
              {c.companies_house_number ? (
                <a
                  className="inline-flex items-center gap-1 hover:text-brand-700"
                  href={`https://find-and-update.company-information.service.gov.uk/company/${c.companies_house_number}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Landmark className="h-3 w-3" /> CH {c.companies_house_number}
                </a>
              ) : null}
              {c.ch_last_accounts_date ? (
                <span>Last accounts: {formatDate(c.ch_last_accounts_date)}</span>
              ) : null}
            </div>
          </div>
          {isStaff(profile) ? <ClinicEditButton clinic={c} /> : null}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Revenue estimate" value={formatGBP(c.revenue_estimate)} financial />
          <Stat label="Practitioners" value={c.practitioner_count?.toString() ?? "—"} />
          <Stat label="Sites" value={c.sites_count.toString()} />
          <Stat label="Score" value={c.score ? Number(c.score).toFixed(0) : "—"} />
        </dl>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Deals</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {deals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not attached to any deal yet.</p>
            ) : (
              deals.map((d) => (
                <Link key={d.id} href={`/deals/${d.id}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors hover:border-brand-300">
                  <span className="font-medium">{d.name}</span>
                  <ColumnChip column={d.pipeline_column as never} />
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Contacts</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {(contacts ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No contacts at this clinic.</p>
            ) : (
              ((contacts ?? []) as Contact[]).map((person) => (
                <Link key={person.id} href={`/contacts/${person.id}`}
                  className="flex items-center gap-2.5 rounded-md border px-3 py-2 transition-colors hover:border-brand-300">
                  <UserAvatar name={person.full_name} className="h-7 w-7" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{person.full_name}</p>
                    <p className="text-xs text-muted-foreground">{person.emails[0] ?? ""}</p>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {CONTACT_ROLE_LABELS[person.role]}
                  </Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Companies House signals</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {(signals ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No signals.</p>
            ) : (
              ((signals ?? []) as ChSignal[]).map((s) => (
                <div key={s.id} className="rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">{s.signal_type.replace("_", " ")}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(s.seen_on)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {Object.entries(s.detail).map(([k, v]) => `${k.replace("_", " ")}: ${v}`).join(" · ")}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Email matching aliases</CardTitle></CardHeader>
          <CardContent>
            {(aliases ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No aliases — add some in Admin to help the email matcher.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(aliases ?? []).map((a) => (
                  <Badge key={a.id as string} variant="outline">{a.alias as string}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, financial }: { label: string; value: string; financial?: boolean }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold" data-financial={financial ? "" : undefined}>{value}</p>
    </div>
  );
}
