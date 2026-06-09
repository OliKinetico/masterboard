/**
 * WhatsApp chat export parser (spec §5.5) — a critical surface, heavily
 * unit-tested. Handles:
 *  - Android format:  `DD/MM/YYYY, HH:MM - Name: message`
 *  - iOS format:      `[DD/MM/YYYY, HH:MM:SS] Name: message`
 *  - multi-line messages (continuation lines append to the previous message)
 *  - media placeholders (`<Media omitted>`, `image omitted`, …) counted, not stored
 *  - system lines (encryption notice, group events) skipped + counted
 *  - 12h/24h times, 2- and 4-digit years, U+200E/U+200F marks
 *
 * Output: messages grouped into ONE entry per calendar day (day-collapse).
 */

export interface WhatsAppMessage {
  time: string; // HH:MM (24h)
  sender: string;
  text: string;
}

export interface WhatsAppDay {
  date: string; // ISO yyyy-mm-dd
  messages: WhatsAppMessage[];
  mediaOmitted: number;
}

export interface ParseResult {
  days: WhatsAppDay[];
  totalMessages: number;
  totalMediaOmitted: number;
  systemLinesSkipped: number;
  unparseableLines: string[];
  dateRange: { from: string; to: string } | null;
  format: "android" | "ios" | "unknown";
}

// Android: 12/04/2026, 09:15 - Sarah: text   (also 12h: 9:15 pm, 2-digit year)
const ANDROID_RE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\s+-\s(.*)$/;

// iOS: [12/04/2026, 09:15:22] Sarah: text
const IOS_RE =
  /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\]\s?(.*)$/;

const MEDIA_PATTERNS = [
  /^<media omitted>$/i,
  /^<?media omitted>?$/i,
  /^image omitted$/i,
  /^video omitted$/i,
  /^audio omitted$/i,
  /^sticker omitted$/i,
  /^gif omitted$/i,
  /^document omitted$/i,
  /^contact card omitted$/i,
  /^<attached:\s.+>$/i,
  /^null$/,
];

const SYSTEM_PATTERNS = [
  /messages and calls are end-to-end encrypted/i,
  /messages to this (chat|group) are now secured/i,
  /created group/i,
  /created this group/i,
  /added you/i,
  /\badded\b.+\bto the group\b/i,
  /you added/i,
  /left$/i,
  /removed/i,
  /changed (the subject|this group's icon|their phone number|the group description)/i,
  /joined using this group's invite link/i,
  /security code changed/i,
  /you blocked this contact/i,
  /missed (voice|video) call/i,
  /(started|ended) a call/i,
  /turned on disappearing messages/i,
  /pinned a message/i,
  /deleted this message/i,
  /this message was deleted/i,
];

function isMedia(text: string): boolean {
  const t = text.trim();
  return MEDIA_PATTERNS.some((re) => re.test(t));
}

function isSystem(text: string): boolean {
  return SYSTEM_PATTERNS.some((re) => re.test(text));
}

function toIsoDate(d: string, m: string, y: string): string | null {
  const day = Number(d);
  const month = Number(m);
  let year = Number(y);
  if (year < 100) year += 2000;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function to24h(hours: string, minutes: string, ampm?: string): string {
  let h = Number(hours);
  if (ampm) {
    const isPm = ampm.toLowerCase() === "pm";
    if (isPm && h !== 12) h += 12;
    if (!isPm && h === 12) h = 0;
  }
  return `${String(h).padStart(2, "0")}:${minutes}`;
}

export function parseWhatsAppExport(raw: string): ParseResult {
  const lines = raw
    .replace(/[\u200e\u200f\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/);

  const dayMap = new Map<string, WhatsAppDay>();
  let totalMessages = 0;
  let totalMedia = 0;
  let systemSkipped = 0;
  const unparseable: string[] = [];
  let format: ParseResult["format"] = "unknown";

  let current: { day: WhatsAppDay; message: WhatsAppMessage } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const iosMatch = line.match(IOS_RE);
    const androidMatch = iosMatch ? null : line.match(ANDROID_RE);
    const match = iosMatch ?? androidMatch;

    if (!match) {
      // continuation of the previous message, if there is one
      if (current) {
        current.message.text += `\n${line}`;
      } else {
        unparseable.push(line.slice(0, 200));
      }
      continue;
    }

    if (iosMatch) format = format === "android" ? format : "ios";
    else format = format === "ios" ? format : "android";

    const [, d, m, y, hh, mm, ampm, rest] = match;
    const iso = toIsoDate(d, m, y);
    if (!iso) {
      unparseable.push(line.slice(0, 200));
      current = null;
      continue;
    }

    // split "Name: message" — system lines have no sender colon
    const senderSplit = rest.indexOf(": ");
    if (senderSplit === -1) {
      systemSkipped += 1;
      current = null;
      continue;
    }
    const sender = rest.slice(0, senderSplit).trim();
    const text = rest.slice(senderSplit + 2);

    if (isSystem(text) && !text.includes(":")) {
      systemSkipped += 1;
      current = null;
      continue;
    }

    let day = dayMap.get(iso);
    if (!day) {
      day = { date: iso, messages: [], mediaOmitted: 0 };
      dayMap.set(iso, day);
    }

    if (isMedia(text)) {
      day.mediaOmitted += 1;
      totalMedia += 1;
      current = null;
      continue;
    }

    const message: WhatsAppMessage = {
      time: to24h(hh, mm, ampm),
      sender,
      text,
    };
    day.messages.push(message);
    totalMessages += 1;
    current = { day, message };
  }

  // drop days that ended up with only media (no storable messages)
  const days = [...dayMap.values()]
    .filter((d) => d.messages.length > 0 || d.mediaOmitted > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    days,
    totalMessages,
    totalMediaOmitted: totalMedia,
    systemLinesSkipped: systemSkipped,
    unparseableLines: unparseable,
    dateRange: days.length
      ? { from: days[0].date, to: days[days.length - 1].date }
      : null,
    format,
  };
}

/** Render a day's messages as the stored transcript body. */
export function dayTranscript(day: WhatsAppDay): string {
  return day.messages.map((m) => `${m.sender}: ${m.text}`).join("\n");
}

/** Summary line: "WhatsApp — 14 messages" (spec §5.4). */
export function daySummary(day: WhatsAppDay): string {
  const n = day.messages.length;
  return `WhatsApp — ${n} message${n === 1 ? "" : "s"}`;
}
