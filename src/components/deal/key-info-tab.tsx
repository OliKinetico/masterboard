"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Info } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { formatGBP } from "@/lib/format";
import { updateDealFields } from "@/server/actions/deals";
import type { Clinic, Deal } from "@/lib/types";

/** Key info (spec §5.2): structured clinic facts + flexible key_info jsonb. */
export function KeyInfoTab({
  deal,
  clinics,
  canEdit,
}: {
  deal: Deal;
  clinics: Clinic[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const totalRevenue = clinics.reduce(
    (sum, c) => sum + (c.revenue_estimate ? Number(c.revenue_estimate) : 0),
    0,
  );
  const totalPractitioners = clinics.reduce(
    (sum, c) => sum + (c.practitioner_count ?? 0),
    0,
  );
  const facts = Object.entries(deal.key_info ?? {});

  function saveFacts(next: Record<string, unknown>) {
    startTransition(async () => {
      const result = await updateDealFields(deal.id, { key_info: next });
      if (result.error) toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Structured</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <Row label="Revenue estimate (all sites)">
              <span data-financial>{formatGBP(totalRevenue || null)}</span>
            </Row>
            <Row label="Practitioners">{totalPractitioners || "—"}</Row>
            <Row label="Sites">{clinics.length}</Row>
            <Row label="Score">
              {clinics[0]?.score ? Number(clinics[0].score).toFixed(0) : "—"}
            </Row>
            <Row label="Disciplines">
              {[...new Set(clinics.flatMap((c) => c.disciplines))].join(", ") || "—"}
            </Row>
            <Row label="Regions">
              {[...new Set(clinics.map((c) => c.region).filter(Boolean))].join(", ") || "—"}
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Facts panel</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {facts.length === 0 ? (
            <EmptyState
              icon={Info}
              title="No facts recorded"
              description="Flexible key facts about this deal — EBITDA basis, seller intentions, project codename…"
              className="py-8"
            />
          ) : (
            <dl className="space-y-1.5 text-sm">
              {facts.map(([key, value]) => (
                <div key={key} className="group flex items-start justify-between gap-3 border-b border-dashed pb-1.5 last:border-0">
                  <dt className="shrink-0 text-xs font-medium text-muted-foreground">{key}</dt>
                  <dd className="flex items-center gap-1.5 text-right">
                    {String(value)}
                    {canEdit ? (
                      <button
                        className="opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer"
                        onClick={() => {
                          const next = { ...deal.key_info };
                          delete next[key];
                          saveFacts(next);
                        }}
                        aria-label={`Remove ${key}`}
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {canEdit ? (
            <div className="flex gap-1.5 pt-1">
              <Input
                className="h-8 text-xs"
                placeholder="Fact"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
              <Input
                className="h-8 text-xs"
                placeholder="Value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newKey.trim() && newValue.trim()) {
                    saveFacts({ ...deal.key_info, [newKey.trim()]: newValue.trim() });
                    setNewKey("");
                    setNewValue("");
                  }
                }}
              />
              <Button
                size="icon-sm"
                variant="outline"
                disabled={pending || !newKey.trim() || !newValue.trim()}
                onClick={() => {
                  saveFacts({ ...deal.key_info, [newKey.trim()]: newValue.trim() });
                  setNewKey("");
                  setNewValue("");
                }}
                aria-label="Add fact"
              >
                <Plus />
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-dashed pb-2 last:border-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
