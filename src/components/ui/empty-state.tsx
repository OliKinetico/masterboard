import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Designed empty state — every list/table/panel renders this rather than
 * a blank area (spec §1.7: no view lacks a designed empty state).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card/50 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Designed error state for failed loads/actions. */
export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50/50 px-6 py-10 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-red-700">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs text-red-600/80">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
