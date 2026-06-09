import { Badge } from "@/components/ui/badge";
import {
  COLUMN_META,
  TIER_META,
  DOC_STATUS_META,
  OFFER_STATUS_META,
  COC_META,
  CHECKLIST_STATUS_META,
  USER_ROLE_LABELS,
  type PipelineColumn,
  type Tier,
  type DocStatus,
  type OfferStatus,
  type ChangeOfControl,
  type ChecklistItemStatus,
  type UserRole,
} from "@/lib/domain";
import { cn } from "@/lib/utils";

/** Status chips — never raw text for a status (spec §3). */

export function ColumnChip({
  column,
  className,
}: {
  column: PipelineColumn;
  className?: string;
}) {
  const meta = COLUMN_META[column];
  return (
    <Badge variant="outline" className={cn(meta.chip, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Badge>
  );
}

export function TierChip({
  tier,
  className,
}: {
  tier: Tier | null | undefined;
  className?: string;
}) {
  if (!tier) return null;
  const meta = TIER_META[tier];
  return (
    <Badge variant="outline" className={cn(meta.chip, className)}>
      {meta.label}
    </Badge>
  );
}

export function DocStatusChip({
  status,
  className,
}: {
  status: DocStatus;
  className?: string;
}) {
  const meta = DOC_STATUS_META[status];
  return (
    <Badge variant="outline" className={cn(meta.chip, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Badge>
  );
}

export function OfferStatusChip({
  status,
  className,
}: {
  status: OfferStatus;
  className?: string;
}) {
  const meta = OFFER_STATUS_META[status];
  return (
    <Badge variant="outline" className={cn(meta.chip, className)}>
      {meta.label}
    </Badge>
  );
}

export function CocChip({
  coc,
  className,
}: {
  coc: ChangeOfControl;
  className?: string;
}) {
  const meta = COC_META[coc];
  return (
    <Badge variant="outline" className={cn(meta.chip, className)}>
      {meta.label}
    </Badge>
  );
}

export function ChecklistStatusChip({
  status,
  className,
}: {
  status: ChecklistItemStatus;
  className?: string;
}) {
  const meta = CHECKLIST_STATUS_META[status];
  return (
    <Badge variant="outline" className={cn(meta.chip, className)}>
      {meta.label}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: UserRole }) {
  return (
    <Badge
      variant="outline"
      className="bg-brand-50 text-brand-700 border-brand-200"
    >
      {USER_ROLE_LABELS[role]}
    </Badge>
  );
}
