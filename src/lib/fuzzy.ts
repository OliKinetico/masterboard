/**
 * Fuzzy matching for the Pipedrive org→clinic mapper and the merge tool
 * (spec §5.8): token-based name similarity with a postcode boost.
 */

function normalise(s: string): string {
  return (
    s
      .toLowerCase()
      // canonicalise discipline words so "physiotherapy" ≈ "physio"
      .replace(/\bphysiotherapy\b/g, "physio")
      .replace(/\bchiropractic\b/g, "chiro")
      .replace(/\bosteopathy|osteopathic\b/g, "osteo")
      // strip legal/structural suffixes only
      .replace(/\b(ltd|limited|llp|plc|the|co)\b/g, " ")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function tokens(s: string): Set<string> {
  return new Set(normalise(s).split(" ").filter(Boolean));
}

/** Dice coefficient over word tokens + char bigrams (0..1). */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) {
    // fall back to raw comparison when normalisation stripped everything
    return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  }
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  const tokenScore = (2 * shared) / (ta.size + tb.size);

  const bigrams = (s: string) => {
    const n = normalise(s).replace(/ /g, "");
    const set = new Set<string>();
    for (let i = 0; i < n.length - 1; i++) set.add(n.slice(i, i + 2));
    return set;
  };
  const ba = bigrams(a);
  const bb = bigrams(b);
  let sharedB = 0;
  for (const g of ba) if (bb.has(g)) sharedB += 1;
  const bigramScore = ba.size && bb.size ? (2 * sharedB) / (ba.size + bb.size) : 0;

  return Math.max(tokenScore, bigramScore);
}

export function normalisePostcode(pc: string | null | undefined): string {
  return (pc ?? "").toUpperCase().replace(/\s+/g, "");
}

/**
 * Combined score: name similarity, +0.15 when postcodes match exactly,
 * +0.07 when outward codes match (capped at 1).
 */
export function clinicMatchScore(
  candidate: { name: string; postcode?: string | null },
  target: { name: string; postcode?: string | null },
): number {
  let score = nameSimilarity(candidate.name, target.name);
  const pa = normalisePostcode(candidate.postcode);
  const pb = normalisePostcode(target.postcode);
  if (pa && pb) {
    if (pa === pb) score += 0.15;
    else if (pa.slice(0, Math.max(2, pa.length - 3)) === pb.slice(0, Math.max(2, pb.length - 3)))
      score += 0.07;
  }
  return Math.min(1, score);
}

export type MatchVerdict = "matched" | "ambiguous" | "unmatched";

export const MATCH_THRESHOLD = 0.85;
export const AMBIGUOUS_THRESHOLD = 0.6;

export function verdictFor(score: number): MatchVerdict {
  if (score >= MATCH_THRESHOLD) return "matched";
  if (score >= AMBIGUOUS_THRESHOLD) return "ambiguous";
  return "unmatched";
}
