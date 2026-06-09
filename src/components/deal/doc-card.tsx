"use client";

import {
  FileText,
  FileSignature,
  Banknote,
  TrendingUp,
  Home,
  ClipboardList,
  Users,
  FileWarning,
  File,
  ExternalLink,
  Cloud,
  Mail,
  FileType,
  Link2,
} from "lucide-react";
import { DocStatusChip } from "@/components/chips";
import {
  DOC_TYPE_LABELS,
  DOC_LOCATION_LABELS,
  type DocLocation,
  type DocType,
} from "@/lib/domain";
import { formatDate, isOverdue } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DocumentRow } from "@/lib/types";

export const DOC_TYPE_ICONS: Record<DocType, typeof FileText> = {
  hots: FileSignature,
  spa: FileText,
  loan_notes: Banknote,
  earn_out: TrendingUp,
  lease: Home,
  ddq: ClipboardList,
  employment_contracts: Users,
  disclosure_letter: FileWarning,
  other: File,
};

const LOCATION_ICONS: Record<DocLocation, typeof Cloud> = {
  sharepoint: Cloud,
  outlook: Mail,
  word: FileType,
  other: Link2,
};

/**
 * Link-out card (spec §3): doc-type icon, title, version, status chip,
 * location icon — opens the source app in a new tab.
 */
export function DocCard({
  doc,
  onClick,
  compact,
}: {
  doc: DocumentRow;
  onClick?: () => void;
  compact?: boolean;
}) {
  const TypeIcon = DOC_TYPE_ICONS[doc.doc_type];
  const LocationIcon = LOCATION_ICONS[doc.location_hint];

  const inner = (
    <div
      className={cn(
        "group flex items-start gap-2.5 rounded-lg border bg-card p-3 transition-all",
        (doc.url || onClick) && "cursor-pointer hover:border-brand-300 hover:shadow-sm",
        compact && "p-2.5",
      )}
      onClick={onClick}
      data-testid={`doc-card-${doc.id}`}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700">
        <TypeIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">{doc.title}</p>
          {doc.version_label ? (
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
              {doc.version_label}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <DocStatusChip status={doc.status} className="px-1.5 py-0 text-[10px]" />
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <LocationIcon className="h-3 w-3" />
            {DOC_LOCATION_LABELS[doc.location_hint]}
          </span>
          {doc.due_on && doc.status !== "signed" ? (
            <span
              className={cn(
                "text-[10px]",
                isOverdue(doc.due_on) ? "font-semibold text-red-600" : "text-muted-foreground",
              )}
            >
              due {formatDate(doc.due_on)}
            </span>
          ) : null}
          <span className="text-[10px] text-muted-foreground">
            {DOC_TYPE_LABELS[doc.doc_type]}
          </span>
        </div>
      </div>
      {doc.url ? (
        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-brand-600" />
      ) : null}
    </div>
  );

  if (doc.url && !onClick) {
    return (
      <a href={doc.url} target="_blank" rel="noreferrer" className="block">
        {inner}
      </a>
    );
  }
  return inner;
}
