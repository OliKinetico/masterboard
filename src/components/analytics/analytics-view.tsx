"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { TrendingDown, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ColumnChip } from "@/components/chips";
import { COLUMN_META, type PipelineColumn } from "@/lib/domain";
import { formatGBPCompact, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface FunnelStage {
  column: PipelineColumn;
  reached: number;
  conversionFromPrev: number | null;
  medianDays: number | null;
}

export interface WeightedColumn {
  column: PipelineColumn;
  count: number;
  weightedValue: number;
  basisValue: number;
  probability: number;
}

export interface PulseWeek {
  label: string;
  start: string;
  manual: number;
  outlook_sync: number;
  whatsapp_import: number;
  pipedrive_migration: number;
}

export interface StaleDeal {
  id: string;
  name: string;
  column: PipelineColumn;
  region: string | null;
  lastInteractionOn: string | null;
  daysSilent: number;
}

export interface DeadReason {
  reason: string;
  count: number;
  deals: string[];
}

export function AnalyticsView({
  funnel,
  weighted,
  pulse,
  stale,
  deadReasons,
  liveCount,
}: {
  funnel: FunnelStage[];
  weighted: WeightedColumn[];
  pulse: PulseWeek[];
  stale: StaleDeal[];
  deadReasons: DeadReason[];
  liveCount: number;
}) {
  const [staleThreshold, setStaleThreshold] = useState<14 | 30>(14);

  const totalWeighted = weighted.reduce(
    (sum, w) => sum + (w.column !== "complete" && w.column !== "dead" ? w.weightedValue : 0),
    0,
  );
  const totalBasis = weighted.reduce(
    (sum, w) => sum + (w.column !== "complete" && w.column !== "dead" ? w.basisValue : 0),
    0,
  );
  const maxReached = Math.max(...funnel.map((f) => f.reached), 1);
  const filteredStale = stale.filter((s) => s.daysSilent >= staleThreshold);

  const chartData = weighted
    .filter((w) => w.column !== "dead" && w.column !== "complete")
    .map((w) => ({
      name: COLUMN_META[w.column].label,
      weighted: Math.round(w.weightedValue),
      column: w.column,
    }));

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">Analytics</h1>

      {/* headline cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Headline label="Weighted pipeline" value={formatGBPCompact(totalWeighted)} accent />
        <Headline label="Unweighted basis" value={formatGBPCompact(totalBasis)} />
        <Headline label="Live deals" value={String(liveCount)} />
        <Headline
          label={`Stale (${staleThreshold}d+)`}
          value={String(filteredStale.length)}
          warn={filteredStale.length > 0}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* funnel */}
        <Card>
          <CardHeader>
            <CardTitle>Funnel</CardTitle>
            <CardDescription>
              Deals that ever reached each stage · conversion from previous · median days in stage
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {funnel.map((stage) => (
              <div key={stage.column} className="flex items-center gap-2">
                <span className="w-36 shrink-0 text-xs font-medium">
                  {COLUMN_META[stage.column].label}
                </span>
                <div className="relative h-6 flex-1 overflow-hidden rounded bg-slate-100">
                  <div
                    className={cn("h-full rounded", COLUMN_META[stage.column].dot)}
                    style={{ width: `${(stage.reached / maxReached) * 100}%`, opacity: 0.75 }}
                  />
                  <span className="absolute inset-y-0 left-2 flex items-center text-xs font-semibold">
                    {stage.reached}
                  </span>
                </div>
                <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">
                  {stage.conversionFromPrev !== null ? `${stage.conversionFromPrev}%` : ""}
                </span>
                <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">
                  {stage.medianDays !== null ? `~${Math.round(stage.medianDays)}d` : "—"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* weighted by column */}
        <Card>
          <CardHeader>
            <CardTitle>Weighted pipeline by column</CardTitle>
            <CardDescription>
              Latest offer EV (else revenue × default multiple) × column probability
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-28} textAnchor="end" height={56} />
                <YAxis tickFormatter={(v: number) => formatGBPCompact(v)} tick={{ fontSize: 10 }} width={52} />
                <Tooltip formatter={(v) => formatGBPCompact(Number(v))} cursor={{ fill: "#f1f5f9" }} />
                <Bar dataKey="weighted" fill="#0d9488" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* activity pulse */}
        <Card>
          <CardHeader>
            <CardTitle>Activity pulse</CardTitle>
            <CardDescription>Interactions per week, by source (last 12 weeks)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={pulse} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={28} />
                <Tooltip cursor={{ fill: "#f1f5f9" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="manual" stackId="a" name="Manual" fill="#64748b" />
                <Bar dataKey="outlook_sync" stackId="a" name="Outlook" fill="#3b82f6" />
                <Bar dataKey="whatsapp_import" stackId="a" name="WhatsApp" fill="#22c55e" />
                <Bar dataKey="pipedrive_migration" stackId="a" name="Pipedrive" fill="#a855f7" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* dead reasons */}
        <Card>
          <CardHeader>
            <CardTitle>Dead-reason breakdown</CardTitle>
            <CardDescription>Why deals died — keep the funnel honest</CardDescription>
          </CardHeader>
          <CardContent>
            {deadReasons.length === 0 ? (
              <EmptyState icon={TrendingDown} title="No dead deals" className="py-8" />
            ) : (
              <ul className="space-y-2">
                {deadReasons.map((r) => (
                  <li key={r.reason} className="rounded-md border px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm">{r.reason}</p>
                      <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
                        {r.count}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{r.deals.join(", ")}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* stale deals */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Stale deals</CardTitle>
            <CardDescription>Live deals with no interaction logged recently</CardDescription>
          </div>
          <div className="flex rounded-md border p-0.5">
            {([14, 30] as const).map((t) => (
              <button
                key={t}
                onClick={() => setStaleThreshold(t)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium cursor-pointer",
                  staleThreshold === t ? "bg-brand-50 text-brand-700" : "text-muted-foreground",
                )}
              >
                {t}+ days
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {filteredStale.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="Nothing stale"
              description={`Every live deal has an interaction in the last ${staleThreshold} days.`}
              className="py-8"
            />
          ) : (
            <ul className="divide-y">
              {filteredStale.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2">
                  <Link href={`/deals/${s.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand-700 hover:underline">
                    {s.name}
                  </Link>
                  <ColumnChip column={s.column} />
                  <span className="hidden w-28 text-xs text-muted-foreground sm:block">{s.region ?? ""}</span>
                  <span className="w-32 text-right text-xs text-muted-foreground">
                    {s.lastInteractionOn ? `last: ${formatDate(s.lastInteractionOn)}` : "never contacted"}
                  </span>
                  <span className={cn("w-14 text-right text-sm font-semibold", s.daysSilent > 30 ? "text-red-600" : "text-amber-600")}>
                    {s.daysSilent === 9999 ? "∞" : `${s.daysSilent}d`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Headline({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4",
        accent && "border-brand-200 bg-gradient-to-br from-brand-50 to-card",
      )}
    >
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight",
          accent && "text-brand-700",
          warn && "text-amber-600",
        )}
        data-financial
      >
        {value}
      </p>
    </div>
  );
}
