/**
 * Default valuation multiple applied to clinics.revenue_estimate when a deal
 * has no offer yet (weighted pipeline, spec §5.10). See ASSUMPTIONS #5.
 */
export const DEFAULT_REVENUE_MULTIPLE = 1.0;

/** Stale thresholds (days without any interaction) — spec §5.10. */
export const STALE_THRESHOLDS = [14, 30] as const;
