"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Upload, FileText, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  previewWhatsApp,
  commitWhatsApp,
  type WhatsAppPreview,
} from "@/server/actions/whatsapp";
import { formatDate } from "@/lib/format";

/**
 * WhatsApp import (spec §5.5): contact → upload .txt/.zip → parse preview
 * (days, counts, media omitted, range, unparseable lines) → commit.
 */
export function WhatsAppImportButton({
  contactId,
  contactName,
}: {
  contactId: string;
  contactName: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [preview, setPreview] = useState<WhatsAppPreview | null>(null);
  const [dealId, setDealId] = useState<string>("");
  const [result, setResult] = useState<{ inserted: number; updated: number } | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setFile(null);
    setPreview(null);
    setDealId("");
    setResult(null);
  }

  async function onFile(f: File) {
    const buf = await f.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);
    setFile({ name: f.name, base64 });
    startTransition(async () => {
      const res = await previewWhatsApp(contactId, f.name, base64);
      if (res.error) {
        toast.error(res.error);
        setFile(null);
        return;
      }
      setPreview(res.preview!);
      setDealId(res.preview!.suggestedDeal?.id ?? "");
    });
  }

  function commit() {
    if (!file || !dealId) return;
    startTransition(async () => {
      const res = await commitWhatsApp(contactId, dealId, file.name, file.base64);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setResult({ inserted: res.inserted ?? 0, updated: res.updated ?? 0 });
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="whatsapp-import">
        <MessageCircle className="text-green-600" /> Import WhatsApp
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import WhatsApp chat</DialogTitle>
            <DialogDescription>
              Export the chat with {contactName} (without media) and upload the
              .txt or .zip. Messages collapse to one timeline entry per day —
              re-importing a longer export replaces days, never duplicates.
            </DialogDescription>
          </DialogHeader>

          {result ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="text-sm font-medium">Import complete</p>
              <p className="text-sm text-muted-foreground">
                {result.inserted} day {result.inserted === 1 ? "entry" : "entries"} created
                {result.updated > 0 ? `, ${result.updated} replaced (no duplicates)` : ""}.
              </p>
              <Button size="sm" className="mt-2" onClick={() => { setOpen(false); reset(); }}>
                Done
              </Button>
            </div>
          ) : !preview ? (
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.zip"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
              <button
                className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors hover:border-brand-300 hover:bg-brand-50/40 cursor-pointer"
                onClick={() => fileRef.current?.click()}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
                ) : (
                  <Upload className="h-6 w-6 text-brand-600" />
                )}
                <p className="text-sm font-medium">
                  {pending ? "Parsing…" : "Choose chat export (.txt or .zip)"}
                </p>
                <p className="text-xs text-muted-foreground">
                  WhatsApp → chat → ⋮ → More → Export chat → Without media
                </p>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
                <FileText className="h-4 w-4 text-slate-400" />
                <span className="truncate font-medium">{file?.name}</span>
                <span className="ml-auto text-xs uppercase text-muted-foreground">
                  {preview.parse.format}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Days found" value={preview.parse.dayCount} />
                <Stat label="Messages" value={preview.parse.totalMessages} />
                <Stat label="Media omitted" value={preview.parse.totalMediaOmitted} />
                <Stat label="System skipped" value={preview.parse.systemLinesSkipped} />
              </div>
              {preview.parse.dateRange ? (
                <p className="text-xs text-muted-foreground">
                  {formatDate(preview.parse.dateRange.from)} → {formatDate(preview.parse.dateRange.to)}
                </p>
              ) : null}

              <div className="max-h-36 overflow-y-auto rounded-md border">
                <table className="w-full text-xs">
                  <tbody>
                    {preview.parse.days.map((d) => (
                      <tr key={d.date} className="border-b last:border-0">
                        <td className="px-3 py-1.5">{formatDate(d.date)}</td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">
                          {d.messages} messages
                          {d.mediaOmitted ? ` · ${d.mediaOmitted} media` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {preview.parse.unparseableLines.length ? (
                <details className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-medium text-amber-700">
                    {preview.parse.unparseableLines.length} unparseable line
                    {preview.parse.unparseableLines.length === 1 ? "" : "s"} (will be skipped)
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-amber-800">
                    {preview.parse.unparseableLines.slice(0, 10).map((l, i) => (
                      <li key={i} className="truncate font-mono">{l}</li>
                    ))}
                  </ul>
                </details>
              ) : null}

              <div className="space-y-1">
                <Label>Attach to deal</Label>
                <Select value={dealId} onValueChange={setDealId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a live deal…" />
                  </SelectTrigger>
                  <SelectContent>
                    {preview.liveDeals.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                        {preview.suggestedDeal?.id === d.id ? " (suggested)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={reset}>Back</Button>
                <Button onClick={commit} disabled={pending || !dealId} data-testid="whatsapp-commit">
                  {pending ? <Loader2 className="animate-spin" /> : null}
                  Import {preview.parse.dayCount} day entries
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-slate-50 px-2.5 py-1.5 text-center">
      <p className="text-base font-semibold" data-financial>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}
