import { createHash } from "node:crypto";

/**
 * Deterministic UUID from a stable key — keeps every seed run identical and
 * lets fixtures (emails, WhatsApp exports) reference seeded rows by id.
 */
export function did(key: string): string {
  const h = createHash("sha256").update(`kinetico-seed:${key}`).digest("hex");
  // format as UUID v4-shaped (version/variant bits forced)
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    "4" + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join("-");
}

/** Mulberry32 — tiny deterministic PRNG for filler data. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length)];
}

export function daysAgoISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function daysFromNowISO(days: number): string {
  return daysAgoISO(-days);
}

/** Email-safe domain from a clinic name: "Riverside Physio" -> riversidephysio.co.uk */
export function domainOf(clinicName: string): string {
  return (
    clinicName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 24) + ".co.uk"
  );
}
