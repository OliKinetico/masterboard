import { describe, expect, it } from "vitest";
import { buildMatcherIndexes, matchEmail } from "./matcher";
import { guessDocType } from "./doc-type-guess";

const MAILBOX = "oli@kinetico.health";

const indexes = buildMatcherIndexes(
  [
    { id: "contact-sarah", emails: ["sarah@riversidephysio.co.uk"], dealId: "deal-riverside" },
    { id: "contact-tom", emails: ["tom@brycecf.co.uk", "tom.bryce@gmail.com"], dealId: "deal-riverside" },
    { id: "contact-nodeal", emails: ["someone@noclinic.co.uk"], dealId: null },
  ],
  [
    { clinic_id: "clinic-harborne", alias: "Harborne Spine & Sport", dealId: "deal-harborne" },
    { clinic_id: "clinic-harborne", alias: "Harborne Spine", dealId: "deal-harborne" },
    { clinic_id: "clinic-dead", alias: "Granite City Physio", dealId: null },
    { clinic_id: "clinic-x", alias: "Spa", dealId: "deal-x" }, // <4 chars → ignored
  ],
);

function msg(overrides: Partial<Parameters<typeof matchEmail>[0]>) {
  return {
    from: { name: "X", address: "unknown@example.com" },
    to: [{ name: "Oli", address: MAILBOX }],
    cc: [],
    subject: "Hello",
    body: "Nothing relevant",
    ...overrides,
  };
}

describe("email matcher pipeline", () => {
  it("matches by sender address → contact's live deal", () => {
    const result = matchEmail(
      msg({ from: { name: "Sarah", address: "sarah@riversidephysio.co.uk" } }),
      indexes,
      MAILBOX,
    );
    expect(result).toEqual({
      dealId: "deal-riverside",
      contactId: "contact-sarah",
      matchedBy: "address",
    });
  });

  it("matches by recipient address on outbound mail (ignores our own mailbox)", () => {
    const result = matchEmail(
      msg({
        from: { name: "Oli", address: MAILBOX },
        to: [{ name: "Tom", address: "tom.bryce@gmail.com" }],
      }),
      indexes,
      MAILBOX,
    );
    expect(result?.dealId).toBe("deal-riverside");
    expect(result?.contactId).toBe("contact-tom");
    expect(result?.matchedBy).toBe("address");
  });

  it("address matching is case-insensitive", () => {
    const result = matchEmail(
      msg({ from: { name: "Sarah", address: "Sarah@RiversidePhysio.co.uk" } }),
      indexes,
      MAILBOX,
    );
    expect(result?.dealId).toBe("deal-riverside");
  });

  it("falls back to clinic alias in the subject (matched_by=keyword)", () => {
    const result = matchEmail(
      msg({ subject: "Harborne Spine & Sport — reference request" }),
      indexes,
      MAILBOX,
    );
    expect(result).toEqual({
      dealId: "deal-harborne",
      contactId: null,
      matchedBy: "keyword",
    });
  });

  it("finds aliases in the body too", () => {
    const result = matchEmail(
      msg({ body: "I'm writing about the Harborne Spine premises next door." }),
      indexes,
      MAILBOX,
    );
    expect(result?.dealId).toBe("deal-harborne");
    expect(result?.matchedBy).toBe("keyword");
  });

  it("ignores aliases whose clinic has no live deal", () => {
    const result = matchEmail(
      msg({ subject: "Granite City Physio enquiry" }),
      indexes,
      MAILBOX,
    );
    expect(result).toBeNull();
  });

  it("ignores too-short aliases that would cause false positives", () => {
    const result = matchEmail(msg({ body: "We visited a spa at the weekend" }), indexes, MAILBOX);
    expect(result).toBeNull();
  });

  it("contacts without a live deal do not address-match", () => {
    const result = matchEmail(
      msg({ from: { name: "N", address: "someone@noclinic.co.uk" } }),
      indexes,
      MAILBOX,
    );
    expect(result).toBeNull();
  });

  it("returns null for genuinely unmatched mail → Unmatched Inbox", () => {
    const result = matchEmail(
      msg({ subject: "Off-market opportunity — podiatry group" }),
      indexes,
      MAILBOX,
    );
    expect(result).toBeNull();
  });
});

describe("attachment doc-type heuristics", () => {
  it.each([
    ["Riverside_SPA_v3.docx", "spa"],
    ["share-purchase-agreement-draft.pdf", "spa"],
    ["Loan Note Instrument v1.docx", "loan_notes"],
    ["earn-out-schedule.xlsx", "earn_out"],
    ["Heads of Terms FINAL.pdf", "hots"],
    ["HoTs_signed.pdf", "hots"],
    ["Putney_lease_consent_letter.pdf", "lease"],
    ["DDQ_responses.pdf", "ddq"],
    ["employment_contracts_bundle.zip", "employment_contracts"],
    ["disclosure letter draft.docx", "disclosure_letter"],
    ["accounts_FY24.pdf", "other"],
  ])("%s → %s", (filename, expected) => {
    expect(guessDocType(filename)).toBe(expected);
  });
});
