/** Formatting helpers — £ with thousands separators, dates, relative time. */

const gbp0 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const gbpCompact = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatGBP(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return gbp0.format(n);
}

/** Compact form for dense surfaces: £1.2m, £450k */
export function formatGBPCompact(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return gbpCompact.format(n).toLowerCase().replace("£", "£");
}

export function formatMultiple(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}×`;
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return `${Math.round(value * 100)}%`;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return dateFmt.format(d);
}

export function formatDateTime(
  value: string | Date | null | undefined,
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return dateTimeFmt.format(d);
}

/** Days between a date and today (positive = in the past). */
export function daysAgo(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

export function formatRelativeDays(
  value: string | Date | null | undefined,
): string {
  const days = daysAgo(value);
  if (days === null) return "—";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  if (days < 0) return `in ${-days}d`;
  return `${days}d ago`;
}

export function isOverdue(value: string | Date | null | undefined): boolean {
  const days = daysAgo(value);
  return days !== null && days > 0;
}
