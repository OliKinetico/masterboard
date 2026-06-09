import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseWhatsAppExport, dayTranscript, daySummary } from "./parser";
import { whatsappDayRef } from "./hash";

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "fixtures", "whatsapp", name), "utf8");

describe("WhatsApp parser — Android export (Sarah / flagship round-trip)", () => {
  const result = parseWhatsAppExport(fixture("android-sarah.txt"));

  it("detects the Android format", () => {
    expect(result.format).toBe("android");
  });

  it("collapses to one entry per calendar day", () => {
    expect(result.days.map((d) => d.date)).toEqual([
      "2026-04-12",
      "2026-04-13",
      "2026-04-15",
      "2026-04-16",
      "2026-04-18",
    ]);
  });

  it("counts messages per day correctly", () => {
    expect(result.days.map((d) => d.messages.length)).toEqual([6, 4, 9, 3, 4]);
    expect(result.totalMessages).toBe(26);
  });

  it("counts media without storing it", () => {
    expect(result.totalMediaOmitted).toBe(1);
    expect(result.days[2].mediaOmitted).toBe(1);
    expect(dayTranscript(result.days[2])).not.toContain("Media omitted");
  });

  it("skips the encryption system line", () => {
    expect(result.systemLinesSkipped).toBe(1);
    expect(result.unparseableLines).toEqual([]);
  });

  it("reports the date range for the preview", () => {
    expect(result.dateRange).toEqual({ from: "2026-04-12", to: "2026-04-18" });
  });

  it("builds the day summary line", () => {
    expect(daySummary(result.days[0])).toBe("WhatsApp — 6 messages");
  });
});

describe("WhatsApp parser — iOS export (bracketed, seconds, U+200E)", () => {
  const result = parseWhatsAppExport(fixture("ios-mark.txt"));

  it("detects the iOS format", () => {
    expect(result.format).toBe("ios");
  });

  it("day-collapses correctly", () => {
    expect(result.days.map((d) => d.date)).toEqual([
      "2026-05-02",
      "2026-05-03",
      "2026-05-05",
    ]);
    expect(result.days.map((d) => d.messages.length)).toEqual([5, 3, 3]);
  });

  it("treats `image omitted` as media even with a U+200E prefix", () => {
    expect(result.totalMediaOmitted).toBe(1);
    expect(result.days[0].mediaOmitted).toBe(1);
  });

  it("keeps 24h times with seconds stripped", () => {
    expect(result.days[0].messages[0].time).toBe("09:12");
  });
});

describe("WhatsApp parser — multi-line + media-heavy export", () => {
  const result = parseWhatsAppExport(fixture("android-emma-multiline.txt"));

  it("appends continuation lines to the previous message", () => {
    const first = result.days[0].messages[0];
    expect(first.text).toContain("- Jan: 14 days");
    expect(first.text.split("\n")).toHaveLength(5);
  });

  it("counts multi-line messages once", () => {
    expect(result.days.map((d) => d.messages.length)).toEqual([5, 2]);
    expect(result.totalMessages).toBe(7);
  });

  it("counts every media placeholder variant", () => {
    expect(result.totalMediaOmitted).toBe(3); // 2× <Media omitted> + video omitted
  });

  it("renders transcripts with sender prefixes", () => {
    expect(dayTranscript(result.days[0])).toMatch(/^Emma Carlton: Sending the locum/);
  });
});

describe("WhatsApp parser — edge-case soup", () => {
  const result = parseWhatsAppExport(fixture("edge-case-soup.txt"));

  it("handles 2-digit years", () => {
    expect(result.days[0].date).toBe("2026-02-01");
  });

  it("converts 12h times to 24h (incl. 12am/12pm)", () => {
    const times = result.days[0].messages.map((m) => m.time);
    expect(times).toContain("09:05"); // 9:05 am (with nbsp before am)
    expect(times).toContain("00:01"); // 12:01 am
    expect(times).toContain("12:30"); // 12:30 pm
  });

  it("skips group events, deleted messages and call notices as system lines", () => {
    expect(result.systemLinesSkipped).toBe(4);
  });

  it("lists genuinely unparseable lines for the preview", () => {
    expect(result.unparseableLines).toHaveLength(1);
    expect(result.unparseableLines[0]).toContain("random corrupted line");
  });

  it("counts <attached: …> exports as media", () => {
    expect(result.totalMediaOmitted).toBe(2);
  });

  it("still parses the multi-line message after junk", () => {
    const day3 = result.days.find((d) => d.date === "2026-02-03")!;
    expect(day3.messages).toHaveLength(1);
    expect(day3.messages[0].text.split("\n")).toHaveLength(3);
  });
});

describe("whatsappDayRef idempotency key", () => {
  it("is deterministic per contact + day", () => {
    expect(whatsappDayRef("contact-1", "2026-04-12")).toBe(
      whatsappDayRef("contact-1", "2026-04-12"),
    );
  });
  it("differs across contacts and days", () => {
    expect(whatsappDayRef("contact-1", "2026-04-12")).not.toBe(
      whatsappDayRef("contact-2", "2026-04-12"),
    );
    expect(whatsappDayRef("contact-1", "2026-04-12")).not.toBe(
      whatsappDayRef("contact-1", "2026-04-13"),
    );
  });
});
