"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Inbox, RefreshCw, Paperclip, UserPlus, X, Loader2, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ColumnChip } from "@/components/chips";
import {
  runEmailSync, assignUnmatchedEmail, dismissUnmatchedEmail,
} from "@/server/actions/email-sync";
import { formatDateTime } from "@/lib/format";
import { CONTACT_ROLES, CONTACT_ROLE_LABELS, type PipelineColumn } from "@/lib/domain";

interface UnmatchedEmail {
  id: string;
  from_name: string | null;
  from_address: string;
  subject: string | null;
  body_preview: string | null;
  body: string | null;
  received_at: string;
  attachments: Array<{ name: string; deepLink: string }>;
}

interface LastRun {
  started_at: string;
  finished_at: string | null;
  status: string;
  counts: Record<string, unknown>;
  error: string | null;
}

export function UnmatchedInbox({
  emails,
  lastRun,
  canAct,
}: {
  emails: UnmatchedEmail[];
  lastRun: LastRun | null;
  canAct: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [assigning, setAssigning] = useState<UnmatchedEmail | null>(null);

  function sync() {
    startTransition(async () => {
      const result = await runEmailSync();
      if (result.error) {
        toast.error(`Sync failed: ${result.error}`);
      } else {
        const c = result.counts!;
        toast.success(
          `Sync ${result.status}: ${c.provider_delta} from provider — ${c.written_new} new, ${c.written_updated} updated, ${c.unmatched_new} unmatched`,
        );
      }
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Unmatched Inbox</h1>
        <span className="text-xs text-muted-foreground">
          {emails.length} pending
        </span>
        {canAct ? (
          <Button size="sm" className="ml-auto" onClick={sync} disabled={pending} data-testid="run-email-sync">
            {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Run email sync
          </Button>
        ) : null}
      </div>

      {lastRun ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
          {lastRun.status === "success" ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          )}
          Last sync {formatDateTime(lastRun.started_at)} — {lastRun.status}
          {Object.entries(lastRun.counts ?? {}).map(([k, v]) => (
            <Badge key={k} variant="secondary" className="text-[10px] font-normal">
              {k.replaceAll("_", " ")}: {String(v)}
            </Badge>
          ))}
          {lastRun.error ? <span className="text-amber-600">{lastRun.error}</span> : null}
        </div>
      ) : null}

      {emails.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Inbox zero — nothing unmatched"
          description="Emails that match no contact address and no clinic alias land here for one-tap assignment."
          action={canAct ? <Button size="sm" variant="outline" onClick={sync} disabled={pending}>Run a sync now</Button> : undefined}
        />
      ) : (
        <ul className="space-y-2">
          {emails.map((email) => (
            <li key={email.id} className="rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {email.subject || "(no subject)"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {email.from_name ? `${email.from_name} · ` : ""}
                    {email.from_address} · {formatDateTime(email.received_at)}
                  </p>
                  {email.body_preview ? (
                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                      {email.body_preview}
                    </p>
                  ) : null}
                  {email.attachments?.length ? (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Paperclip className="h-3 w-3" />
                      {email.attachments.map((a) => a.name).join(", ")}
                    </p>
                  ) : null}
                </div>
                {canAct ? (
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" onClick={() => setAssigning(email)} data-testid={`assign-${email.id}`}>
                      Assign to deal
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() =>
                        startTransition(async () => {
                          await dismissUnmatchedEmail(email.id);
                          router.refresh();
                        })
                      }
                      aria-label="Dismiss"
                      title="Dismiss — not deal-related"
                    >
                      <X />
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AssignDialog email={assigning} onClose={() => setAssigning(null)} />
    </div>
  );
}

function AssignDialog({
  email,
  onClose,
}: {
  email: UnmatchedEmail | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [deals, setDeals] = useState<Array<{ id: string; name: string; pipeline_column: PipelineColumn }>>([]);
  const [dealId, setDealId] = useState("");
  const [createContact, setCreateContact] = useState(true);
  const [role, setRole] = useState("other");

  useEffect(() => {
    if (!email) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const json = await res.json();
        setDeals(json.deals ?? []);
      }
    }, 130);
    return () => clearTimeout(t);
  }, [query, email]);

  function submit() {
    if (!email || !dealId) return;
    startTransition(async () => {
      const result = await assignUnmatchedEmail({
        emailId: email.id,
        dealId,
        createContact,
        contactRole: role,
      });
      if (result.error) toast.error(result.error);
      else {
        toast.success(createContact
          ? "Assigned — sender saved as contact, the matcher will catch them next time"
          : "Assigned to deal");
        onClose();
      }
      router.refresh();
    });
  }

  return (
    <Dialog open={!!email} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign email to deal</DialogTitle>
          <DialogDescription className="truncate">
            “{email?.subject || "(no subject)"}” from {email?.from_address}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Search live deals…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {deals.map((d) => (
              <button
                key={d.id}
                onClick={() => setDealId(d.id)}
                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors cursor-pointer ${
                  dealId === d.id ? "border-brand-400 bg-brand-50" : "hover:bg-slate-50"
                }`}
              >
                <span className="truncate font-medium">{d.name}</span>
                <ColumnChip column={d.pipeline_column} />
              </button>
            ))}
          </div>

          <div className="space-y-2 rounded-md border bg-slate-50 p-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={createContact} onCheckedChange={(v) => setCreateContact(v === true)} />
              <UserPlus className="h-3.5 w-3.5 text-brand-600" />
              Save sender as a contact (the matcher learns)
            </label>
            {createContact ? (
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTACT_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{CONTACT_ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={pending || !dealId} data-testid="confirm-assign">
            {pending ? <Loader2 className="animate-spin" /> : null}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
