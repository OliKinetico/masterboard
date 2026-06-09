"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Landmark, Loader2, Merge, Play, Plus, Trash2, X, FileDown,
} from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { RoleBadge } from "@/components/chips";
import {
  USER_ROLES, USER_ROLE_LABELS, COLUMN_META, DOC_TYPES, DOC_TYPE_LABELS,
  DOC_STATUSES, DOC_STATUS_META, RESPONSIBLES, RESPONSIBLE_LABELS,
  type PipelineColumn, type UserRole,
} from "@/lib/domain";
import { formatDateTime, formatDate } from "@/lib/format";
import {
  setUserRole, grantDealAccess, revokeDealAccess, setColumnProbability,
  addClinicAlias, removeClinicAlias, acknowledgeChSignal,
  upsertLegalTemplate, deleteLegalTemplate,
  upsertChecklistTemplateItem, deleteChecklistTemplateItem,
  mergeClinics, mergeContacts,
} from "@/server/actions/admin";
import { runEmailSync } from "@/server/actions/email-sync";
import { runPipedriveMigration } from "@/server/actions/pipedrive";
import { runChEnrichment, runClinicImport } from "@/server/actions/enrichment";
import { downloadCsv } from "@/lib/csv";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function AdminView(props: {
  profiles: any[];
  access: Array<{ user_id: string; deal_id: string; deals: { name: string } | null }>;
  deals: Array<{ id: string; name: string }>;
  legalTemplates: any[];
  checklistTemplates: Array<any & { checklist_template_items: any[] }>;
  aliases: Array<{ id: string; alias: string; clinic_id: string; clinics: { name: string } | null }>;
  settings: any[];
  syncRuns: any[];
  signals: Array<any & { clinics: { name: string } | null }>;
  clinics: Array<{ id: string; name: string; postcode: string | null }>;
  contacts: Array<{ id: string; full_name: string; emails: string[] }>;
  mergeLog: any[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<string | null>(null);

  function act(fn: () => Promise<{ error?: string } | { error?: string; report?: string }>, success?: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.error) toast.error(result.error);
      else if (success) toast.success(success);
      if ("report" in result && result.report) setReport(result.report);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">Admin</h1>

      <Tabs defaultValue="users">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="users">Users & access</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="aliases">Aliases</TabsTrigger>
          <TabsTrigger value="probabilities">Probabilities</TabsTrigger>
          <TabsTrigger value="syncs">Syncs & imports{props.syncRuns.some((r) => r.status === "warning" || r.status === "error") ? " ⚠" : ""}</TabsTrigger>
          <TabsTrigger value="signals">CH signals{props.signals.length ? ` · ${props.signals.length}` : ""}</TabsTrigger>
          <TabsTrigger value="merge">Merge tool</TabsTrigger>
        </TabsList>

        {/* ── users & roles + viewer grants ─────────────────────────────── */}
        <TabsContent value="users" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Users & roles</CardTitle>
              <CardDescription>Role changes apply immediately (no re-login needed).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {props.profiles.map((p) => (
                <div key={p.user_id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                  <span className="min-w-40 flex-1 text-sm font-medium">{p.full_name}</span>
                  <RoleBadge role={p.role as UserRole} />
                  <Select value={p.role} onValueChange={(v) => act(() => setUserRole(p.user_id, v), "Role updated")}>
                    <SelectTrigger className="h-7 w-auto gap-1 text-xs" disabled={pending}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {USER_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>{USER_ROLE_LABELS[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {p.role === "viewer" ? (
                    <div className="flex w-full flex-wrap items-center gap-1.5 pl-1 pt-1">
                      <span className="text-xs text-muted-foreground">Deal access:</span>
                      {props.access
                        .filter((a) => a.user_id === p.user_id)
                        .map((a) => (
                          <Badge key={a.deal_id} variant="outline" className="gap-1">
                            {a.deals?.name ?? a.deal_id}
                            <button onClick={() => act(() => revokeDealAccess(p.user_id, a.deal_id), "Access revoked")} aria-label="Revoke">
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      <GrantPicker
                        deals={props.deals}
                        onGrant={(dealId) => act(() => grantDealAccess(p.user_id, dealId), "Access granted")}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── templates ─────────────────────────────────────────────────── */}
        <TabsContent value="templates" className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Legal pack template</CardTitle>
              <CardDescription>
                Spawned (in order) when HoTs are signed; leases come from properties.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {props.legalTemplates.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                  <span className="w-5 text-xs text-muted-foreground">{t.sort_order}</span>
                  <span className="flex-1 font-medium">{DOC_TYPE_LABELS[t.doc_type as never] ?? t.doc_type}</span>
                  <Select
                    value={t.initial_status}
                    onValueChange={(v) =>
                      act(() => upsertLegalTemplate({
                        id: t.id, docType: t.doc_type, sortOrder: t.sort_order,
                        initialStatus: v, defaultResponsible: t.default_responsible,
                      }))
                    }
                  >
                    <SelectTrigger className="h-6 w-auto gap-1 text-[11px]" disabled={pending}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOC_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{DOC_STATUS_META[s].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={t.default_responsible}
                    onValueChange={(v) =>
                      act(() => upsertLegalTemplate({
                        id: t.id, docType: t.doc_type, sortOrder: t.sort_order,
                        initialStatus: t.initial_status, defaultResponsible: v,
                      }))
                    }
                  >
                    <SelectTrigger className="h-6 w-auto gap-1 text-[11px]" disabled={pending}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RESPONSIBLES.map((r) => (
                        <SelectItem key={r} value={r}>{RESPONSIBLE_LABELS[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button onClick={() => act(() => deleteLegalTemplate(t.id), "Removed")} aria-label="Delete">
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ))}
              <AddLegalTemplate
                existing={props.legalTemplates.map((t) => t.doc_type)}
                nextSort={Math.max(0, ...props.legalTemplates.map((t) => t.sort_order)) + 1}
                onAdd={(docType, sortOrder) =>
                  act(() => upsertLegalTemplate({
                    docType, sortOrder, initialStatus: "not_started", defaultResponsible: "buyer_solicitors",
                  }), "Added to pack")
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Checklist templates</CardTitle>
              <CardDescription>Instantiated when a deal enters the trigger column.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {props.checklistTemplates.map((t) => (
                <div key={t.id} className="rounded-md border">
                  <div className="flex items-center gap-2 border-b bg-slate-50 px-3 py-1.5">
                    <span className="text-sm font-semibold">{t.name}</span>
                    {t.trigger_column ? (
                      <Badge variant="outline" className={COLUMN_META[t.trigger_column as PipelineColumn].chip}>
                        on {COLUMN_META[t.trigger_column as PipelineColumn].label}
                      </Badge>
                    ) : null}
                  </div>
                  <ul className="divide-y">
                    {[...t.checklist_template_items].sort((a, b) => a.sort - b.sort).map((item) => (
                      <li key={item.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                        <span className="flex-1">{item.title}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {RESPONSIBLE_LABELS[item.default_responsible as never]}
                        </span>
                        <button onClick={() => act(() => deleteChecklistTemplateItem(item.id), "Removed")} aria-label="Delete item">
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <AddChecklistItem
                    onAdd={(title) =>
                      act(() => upsertChecklistTemplateItem({
                        templateId: t.id, title,
                        sort: Math.max(0, ...t.checklist_template_items.map((i: { sort: number }) => i.sort)) + 1,
                        defaultResponsible: "kinetico",
                      }), "Item added")
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── aliases ───────────────────────────────────────────────────── */}
        <TabsContent value="aliases">
          <Card>
            <CardHeader>
              <CardTitle>Clinic aliases</CardTitle>
              <CardDescription>
                The email matcher scans subjects/bodies for these when no contact address matches.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AliasEditor
                aliases={props.aliases}
                clinics={props.clinics}
                pending={pending}
                onAdd={(clinicId, alias) => act(() => addClinicAlias(clinicId, alias), "Alias added")}
                onRemove={(id) => act(() => removeClinicAlias(id))}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── probabilities ─────────────────────────────────────────────── */}
        <TabsContent value="probabilities">
          <Card>
            <CardHeader>
              <CardTitle>Column probabilities</CardTitle>
              <CardDescription>Drive the weighted pipeline forecast (0–1).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {props.settings.map((s) => (
                <div key={s.pipeline_column} className="flex items-center gap-3">
                  <span className="w-44 text-sm">{COLUMN_META[s.pipeline_column as PipelineColumn].label}</span>
                  <Input
                    type="number" step="0.01" min="0" max="1"
                    defaultValue={Number(s.probability)}
                    className="h-8 w-24 text-right"
                    data-financial
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== Number(s.probability)) {
                        act(() => setColumnProbability(s.pipeline_column, v), "Probability saved");
                      }
                    }}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── syncs & imports ───────────────────────────────────────────── */}
        <TabsContent value="syncs" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Manual triggers</CardTitle>
              <CardDescription>
                Every run writes a sync_runs row with reconciled counts — nothing can fail silently.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" disabled={pending} onClick={() => act(() => runEmailSync(), "Email sync finished")}>
                <Play /> Email sync
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => runClinicImport(), "Clinic import finished")}>
                <Play /> Clinic import
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => runPipedriveMigration("dry-run"), "Dry run complete — report below")} data-testid="pd-dry-run">
                <Play /> Pipedrive dry-run
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => runPipedriveMigration("commit"), "Pipedrive migration committed")} data-testid="pd-commit">
                <Play /> Pipedrive commit
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => runChEnrichment(), "Companies House check finished")}>
                <Landmark /> CH enrichment
              </Button>
              {pending ? <Loader2 className="h-4 w-4 animate-spin self-center text-brand-600" /> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sync runs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {props.syncRuns.length === 0 ? (
                <p className="text-sm text-muted-foreground">No runs yet.</p>
              ) : (
                props.syncRuns.map((run) => (
                  <details key={run.id} className="rounded-md border px-3 py-2">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                      <Badge
                        variant="outline"
                        className={
                          run.status === "success"
                            ? "border-green-200 bg-green-50 text-green-700"
                            : run.status === "warning"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : run.status === "error"
                                ? "border-red-200 bg-red-50 text-red-700"
                                : "border-blue-200 bg-blue-50 text-blue-700"
                        }
                      >
                        {run.status}
                      </Badge>
                      <span className="font-medium capitalize">{String(run.source).replace("_", " ")}</span>
                      <span className="text-xs text-muted-foreground">{formatDateTime(run.started_at)}</span>
                      {run.error ? <span className="text-xs text-red-600">{run.error}</span> : null}
                    </summary>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.entries(run.counts ?? {})
                        .filter(([k]) => k !== "report" && k !== "skip_reasons")
                        .map(([k, v]) => (
                          <Badge key={k} variant="secondary" className="text-[10px] font-normal">
                            {k.replaceAll("_", " ")}: {String(v)}
                          </Badge>
                        ))}
                      {run.counts?.report ? (
                        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setReport(run.counts.report)}>
                          <FileDown /> View report
                        </Button>
                      ) : null}
                    </div>
                  </details>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── CH signals ────────────────────────────────────────────────── */}
        <TabsContent value="signals">
          <Card>
            <CardHeader>
              <CardTitle>Companies House signals</CardTitle>
              <CardDescription>Unacknowledged filings on clinics attached to live deals.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {props.signals.length === 0 ? (
                <p className="text-sm text-muted-foreground">All clear — no unacknowledged signals.</p>
              ) : (
                props.signals.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Landmark className="h-4 w-4 text-amber-500" />
                    <span className="font-medium">{s.clinics?.name}</span>
                    <Badge variant="secondary" className="capitalize">{String(s.signal_type).replace("_", " ")}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {Object.entries(s.detail ?? {}).map(([k, v]) => `${k.replaceAll("_", " ")}: ${v}`).join(" · ")}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">{formatDate(s.seen_on)}</span>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => acknowledgeChSignal(s.id), "Acknowledged")}>
                      Acknowledge
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── merge tool ────────────────────────────────────────────────── */}
        <TabsContent value="merge" className="space-y-3">
          <MergeCard
            title="Merge duplicate clinics"
            description="Re-points deals, contacts, properties, signals and aliases to the kept clinic; the duplicate is soft-marked merged and its name becomes an alias."
            options={props.clinics.map((c) => ({ id: c.id, label: `${c.name}${c.postcode ? ` (${c.postcode})` : ""}` }))}
            pending={pending}
            onMerge={(keep, merge) => act(() => mergeClinics(keep, merge), "Clinics merged")}
          />
          <MergeCard
            title="Merge duplicate contacts"
            description="Re-points interactions and unions email addresses onto the kept contact."
            options={props.contacts.map((c) => ({ id: c.id, label: `${c.full_name}${c.emails[0] ? ` (${c.emails[0]})` : ""}` }))}
            pending={pending}
            onMerge={(keep, merge) => act(() => mergeContacts(keep, merge), "Contacts merged")}
          />
          {props.mergeLog.length ? (
            <Card>
              <CardHeader><CardTitle>Merge audit log</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {props.mergeLog.map((m) => (
                  <p key={m.id} className="text-xs text-muted-foreground">
                    {formatDateTime(m.created_at)} — {m.kind} {m.merged_id.slice(0, 8)}… merged into {m.kept_id.slice(0, 8)}…
                    {" "}({Object.entries(m.detail ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ") || "no rows re-pointed"})
                  </p>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
      </Tabs>

      {/* migration report viewer */}
      <Dialog open={!!report} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Migration report</DialogTitle></DialogHeader>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-4 text-xs leading-relaxed">
            {report}
          </pre>
          <Button
            variant="outline"
            onClick={() => {
              if (report) downloadCsv("pipedrive-report.md", report);
            }}
          >
            <FileDown /> Download .md
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GrantPicker({
  deals,
  onGrant,
}: {
  deals: Array<{ id: string; name: string }>;
  onGrant: (dealId: string) => void;
}) {
  return (
    <Select onValueChange={onGrant} value="">
      <SelectTrigger className="h-6 w-auto gap-1 border-dashed text-[11px]">
        <Plus className="h-3 w-3" /> grant deal
      </SelectTrigger>
      <SelectContent>
        {deals.map((d) => (
          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AddLegalTemplate({
  existing,
  nextSort,
  onAdd,
}: {
  existing: string[];
  nextSort: number;
  onAdd: (docType: string, sortOrder: number) => void;
}) {
  const available = DOC_TYPES.filter((t) => t !== "lease" && !existing.includes(t));
  if (!available.length) return null;
  return (
    <Select onValueChange={(v) => onAdd(v, nextSort)} value="">
      <SelectTrigger className="h-7 w-auto gap-1 border-dashed text-xs">
        <Plus className="h-3 w-3" /> add doc type
      </SelectTrigger>
      <SelectContent>
        {available.map((t) => (
          <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AddChecklistItem({ onAdd }: { onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  return (
    <div className="flex gap-1.5 border-t px-3 py-2">
      <Input
        className="h-7 text-xs"
        placeholder="Add item…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim()) {
            onAdd(title.trim());
            setTitle("");
          }
        }}
      />
      <Button
        size="icon-sm" variant="outline" disabled={!title.trim()}
        onClick={() => { onAdd(title.trim()); setTitle(""); }}
        aria-label="Add template item"
      >
        <Plus />
      </Button>
    </div>
  );
}

function AliasEditor({
  aliases,
  clinics,
  pending,
  onAdd,
  onRemove,
}: {
  aliases: Array<{ id: string; alias: string; clinic_id: string; clinics: { name: string } | null }>;
  clinics: Array<{ id: string; name: string }>;
  pending: boolean;
  onAdd: (clinicId: string, alias: string) => void;
  onRemove: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [alias, setAlias] = useState("");

  const visible = filter
    ? aliases.filter(
        (a) =>
          a.alias.toLowerCase().includes(filter.toLowerCase()) ||
          a.clinics?.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : aliases;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <Input className="h-8 w-56 text-xs" placeholder="Filter aliases…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Select value={clinicId} onValueChange={setClinicId}>
          <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Clinic…" /></SelectTrigger>
          <SelectContent>
            {clinics.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input className="h-8 w-44 text-xs" placeholder="New alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
        <Button
          size="sm" className="h-8" disabled={pending || !clinicId || alias.trim().length < 4}
          onClick={() => { onAdd(clinicId, alias.trim()); setAlias(""); }}
        >
          <Plus /> Add
        </Button>
      </div>
      <div className="flex max-h-80 flex-wrap content-start gap-1.5 overflow-y-auto">
        {visible.slice(0, 200).map((a) => (
          <Badge key={a.id} variant="outline" className="gap-1.5 py-1">
            <span className="font-medium">{a.alias}</span>
            <span className="text-muted-foreground">· {a.clinics?.name}</span>
            <button onClick={() => onRemove(a.id)} aria-label={`Remove alias ${a.alias}`}>
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {visible.length > 200 ? (
          <span className="text-xs text-muted-foreground">…{visible.length - 200} more — narrow the filter</span>
        ) : null}
      </div>
    </div>
  );
}

function MergeCard({
  title,
  description,
  options,
  pending,
  onMerge,
}: {
  title: string;
  description: string;
  options: Array<{ id: string; label: string }>;
  pending: boolean;
  onMerge: (keepId: string, mergeId: string) => void;
}) {
  const [keep, setKeep] = useState("");
  const [merge, setMerge] = useState("");
  const keepLabel = options.find((o) => o.id === keep)?.label;
  const mergeLabel = options.find((o) => o.id === merge)?.label;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Keep</p>
            <SearchSelect options={options} value={keep} onChange={setKeep} exclude={merge} />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Merge away (duplicate)</p>
            <SearchSelect options={options} value={merge} onChange={setMerge} exclude={keep} />
          </div>
        </div>
        {keep && merge ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Preview: <b>{mergeLabel}</b> will be merged into <b>{keepLabel}</b>. All references
            re-point to the kept record; the duplicate is hidden from lists but never deleted.
          </div>
        ) : null}
        <Button
          size="sm" disabled={pending || !keep || !merge}
          onClick={() => { onMerge(keep, merge); setKeep(""); setMerge(""); }}
        >
          <Merge /> Merge
        </Button>
      </CardContent>
    </Card>
  );
}

function SearchSelect({
  options,
  value,
  onChange,
  exclude,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
  exclude?: string;
}) {
  const [q, setQ] = useState("");
  const visible = options
    .filter((o) => o.id !== exclude)
    .filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 40);
  return (
    <div className="space-y-1">
      <Input className="h-8 text-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-36 overflow-y-auto rounded-md border">
        {visible.map((o) => (
          <button
            key={o.id}
            className={`block w-full px-2.5 py-1.5 text-left text-xs cursor-pointer ${value === o.id ? "bg-brand-50 font-medium text-brand-800" : "hover:bg-slate-50"}`}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
        {!visible.length ? <p className="px-2.5 py-2 text-xs text-muted-foreground">No matches</p> : null}
      </div>
    </div>
  );
}
