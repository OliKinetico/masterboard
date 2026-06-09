import type { EmailMessage } from "./types";

/**
 * Matcher pipeline (spec §5.7), pure + unit-tested:
 *  1. any participant address ∈ contacts.emails → that contact's live deal
 *  2. else subject+body scanned for clinic_aliases → that clinic's live deal
 *     (flagged matched_by=keyword)
 *  3. else null → Unmatched Inbox
 */

export interface ContactIndexEntry {
  contactId: string;
  dealId: string | null; // live deal via the contact's clinic (null = none)
}

export interface AliasIndexEntry {
  clinicId: string;
  dealId: string | null;
  alias: string;
}

export interface MatchResult {
  dealId: string;
  contactId: string | null;
  matchedBy: "address" | "keyword";
}

export interface MatcherIndexes {
  /** lower-cased email address → contact + live deal */
  byAddress: Map<string, ContactIndexEntry>;
  /** alias entries, longest first */
  aliases: AliasIndexEntry[];
}

export function buildMatcherIndexes(
  contacts: Array<{ id: string; emails: string[]; dealId: string | null }>,
  aliases: Array<{ clinic_id: string; alias: string; dealId: string | null }>,
): MatcherIndexes {
  const byAddress = new Map<string, ContactIndexEntry>();
  for (const c of contacts) {
    for (const email of c.emails) {
      const key = email.trim().toLowerCase();
      if (!key) continue;
      const existing = byAddress.get(key);
      // prefer an entry that actually has a live deal
      if (!existing || (!existing.dealId && c.dealId)) {
        byAddress.set(key, { contactId: c.id, dealId: c.dealId });
      }
    }
  }
  const aliasEntries = aliases
    .filter((a) => a.alias.trim().length >= 4) // short aliases are noise
    .map((a) => ({ clinicId: a.clinic_id, dealId: a.dealId, alias: a.alias.trim() }))
    .sort((a, b) => b.alias.length - a.alias.length);
  return { byAddress, aliases: aliasEntries };
}

export function matchEmail(
  message: Pick<EmailMessage, "from" | "to" | "cc" | "subject" | "body">,
  indexes: MatcherIndexes,
  mailbox: string,
): MatchResult | null {
  // 1. address match — any participant except our own mailbox
  const participants = [message.from, ...message.to, ...message.cc]
    .map((a) => a.address.toLowerCase())
    .filter((a) => a !== mailbox.toLowerCase());

  for (const address of participants) {
    const hit = indexes.byAddress.get(address);
    if (hit?.dealId) {
      return { dealId: hit.dealId, contactId: hit.contactId, matchedBy: "address" };
    }
  }

  // 2. keyword match on subject + body against clinic aliases
  const haystack = `${message.subject}\n${message.body}`.toLowerCase();
  for (const entry of indexes.aliases) {
    if (!entry.dealId) continue;
    if (haystack.includes(entry.alias.toLowerCase())) {
      // attach the sender as contact if their address is known (no deal needed)
      const sender = indexes.byAddress.get(message.from.address.toLowerCase());
      return {
        dealId: entry.dealId,
        contactId: sender?.contactId ?? null,
        matchedBy: "keyword",
      };
    }
  }

  return null;
}
