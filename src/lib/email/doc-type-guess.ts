import type { DocType } from "@/lib/domain";

/**
 * Filename → doc_type heuristics for synced attachments (spec §5.7).
 * Always editable after sync. Order matters: first hit wins.
 */
const RULES: Array<[RegExp, DocType]> = [
  [/\bspa\b|share.?purchase/i, "spa"],
  [/loan.?note/i, "loan_notes"],
  [/earn.?out/i, "earn_out"],
  [/\bhots\b|heads.?of.?terms/i, "hots"],
  [/lease|licence.?to.?assign|rent.?deposit/i, "lease"],
  [/\bddq\b|due.?diligence|data.?room/i, "ddq"],
  [/employment|contract.?of.?employment|deed.?of.?variation/i, "employment_contracts"],
  [/disclosure/i, "disclosure_letter"],
];

export function guessDocType(filename: string): DocType {
  // underscores/dashes/dots act as word separators in filenames
  const normalised = filename.replace(/[_\-.]+/g, " ");
  for (const [re, type] of RULES) {
    if (re.test(normalised)) return type;
  }
  return "other";
}
