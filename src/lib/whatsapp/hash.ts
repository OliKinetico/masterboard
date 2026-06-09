import { createHash } from "node:crypto";

/**
 * Idempotency key for a WhatsApp day-collapsed interaction (spec §5.5):
 * sha256(contact_id + ISO date). Re-importing a longer export of the same
 * chat upserts on this key, so day rows are replaced, never duplicated.
 */
export function whatsappDayRef(contactId: string, isoDate: string): string {
  return (
    "wa:" +
    createHash("sha256").update(`${contactId}:${isoDate}`).digest("hex")
  );
}
