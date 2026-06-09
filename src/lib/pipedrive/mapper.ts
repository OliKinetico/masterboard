import { PIPELINE_COLUMNS, type PipelineColumn } from "@/lib/domain";
import { clinicMatchScore, verdictFor, type MatchVerdict } from "@/lib/fuzzy";
import type { PdDeal, PdOrg } from "./types";

/**
 * Pipedrive → CRM mapping (spec §5.8). Stage names map case/spacing-
 * insensitively onto the ten pipeline columns (ASSUMPTIONS #15); deal status
 * won/lost overrides the stage.
 */

function normaliseStage(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

const STAGE_MAP: Record<string, PipelineColumn> = Object.fromEntries([
  ...PIPELINE_COLUMNS.map((c) => [normaliseStage(c), c] as const),
  ["activediscussions", "active_discussions"],
  ["duediligence", "due_diligence"],
  ["headsofterms", "hots"],
  ["hotssigned", "hots"],
  ["completed", "complete"],
  ["won", "complete"],
  ["lost", "dead"],
  ["onhold", "reengage"],
]);

export function mapStage(deal: Pick<PdDeal, "stage" | "status">): {
  column: PipelineColumn | null;
  needsReview: boolean;
} {
  if (deal.status === "won") return { column: "complete", needsReview: false };
  if (deal.status === "lost") return { column: "dead", needsReview: false };
  const mapped = STAGE_MAP[normaliseStage(deal.stage)];
  return mapped
    ? { column: mapped, needsReview: false }
    : { column: null, needsReview: true };
}

export const ACTIVITY_TYPE_MAP: Record<string, "call" | "meeting" | "email" | "note"> = {
  call: "call",
  meeting: "meeting",
  email: "email",
  lunch: "meeting",
  task: "note",
  deadline: "note",
};

export interface OrgMatch {
  org: PdOrg;
  verdict: MatchVerdict;
  bestClinic: { id: string; name: string; postcode: string | null } | null;
  score: number;
  runnersUp: Array<{ id: string; name: string; score: number }>;
}

/** Fuzzy org→clinic matching on name + postcode (spec §5.8). */
export function matchOrgsToClinics(
  orgs: PdOrg[],
  clinics: Array<{ id: string; name: string; postcode: string | null }>,
): OrgMatch[] {
  return orgs.map((org) => {
    const scored = clinics
      .map((clinic) => ({ clinic, score: clinicMatchScore(org, clinic) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) {
      return { org, verdict: "unmatched" as const, bestClinic: null, score: 0, runnersUp: [] };
    }
    return {
      org,
      verdict: verdictFor(best.score),
      bestClinic: best.score >= 0.6 ? best.clinic : null,
      score: best.score,
      runnersUp: scored
        .slice(1, 3)
        .filter((s) => s.score >= 0.5)
        .map((s) => ({ id: s.clinic.id, name: s.clinic.name, score: s.score })),
    };
  });
}
