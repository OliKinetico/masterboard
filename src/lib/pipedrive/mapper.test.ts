import { describe, expect, it } from "vitest";
import { mapStage, matchOrgsToClinics } from "./mapper";
import { clinicMatchScore, nameSimilarity, verdictFor } from "@/lib/fuzzy";
import { parseCsv } from "@/lib/csv-parse";

describe("Pipedrive stage mapping", () => {
  it("maps the ten column names case/spacing-insensitively", () => {
    expect(mapStage({ stage: "Active Discussions", status: "open" }).column).toBe("active_discussions");
    expect(mapStage({ stage: "due diligence", status: "open" }).column).toBe("due_diligence");
    expect(mapStage({ stage: "HoTs", status: "open" }).column).toBe("hots");
    expect(mapStage({ stage: "Heads of Terms", status: "open" }).column).toBe("hots");
    expect(mapStage({ stage: "Re-engage", status: "open" }).column).toBe("reengage");
    expect(mapStage({ stage: "PLATINUM", status: "open" }).column).toBe("platinum");
  });

  it("deal status won/lost overrides the stage", () => {
    expect(mapStage({ stage: "Due Diligence", status: "won" }).column).toBe("complete");
    expect(mapStage({ stage: "Gold", status: "lost" }).column).toBe("dead");
  });

  it("flags unknown stages for review", () => {
    const result = mapStage({ stage: "Initial Outreach", status: "open" });
    expect(result.column).toBeNull();
    expect(result.needsReview).toBe(true);
  });
});

describe("org → clinic fuzzy matching", () => {
  const clinics = [
    { id: "c1", name: "Granite City Physio", postcode: "AB10 1QR" },
    { id: "c2", name: "The Pennine Physio Co.", postcode: "LS6 3AA" },
    { id: "c3", name: "Albion MSK Clinic", postcode: "M3 4LQ" },
  ];

  it("matches a near-identical name + postcode", () => {
    const [m] = matchOrgsToClinics(
      [{ id: "1", name: "Granite City Physio Ltd", address: "", postcode: "AB10 1QR" }],
      clinics,
    );
    expect(m.verdict).toBe("matched");
    expect(m.bestClinic?.id).toBe("c1");
  });

  it("flags a partial name as ambiguous-needs-review", () => {
    const [m] = matchOrgsToClinics(
      [{ id: "2", name: "Pennine Physiotherapy & Sports", address: "", postcode: "" }],
      clinics,
    );
    expect(m.verdict).toBe("ambiguous");
    expect(m.bestClinic?.id).toBe("c2");
  });

  it("postcode agreement lifts an ambiguous name to matched", () => {
    const [m] = matchOrgsToClinics(
      [{ id: "2b", name: "Pennine Physiotherapy & Sports", address: "", postcode: "LS6 3AA" }],
      clinics,
    );
    expect(m.verdict).toBe("matched");
  });

  it("unknown orgs are unmatched-will-create", () => {
    const [m] = matchOrgsToClinics(
      [{ id: "3", name: "Lakeside Podiatry Group", address: "", postcode: "SO14 3GT" }],
      clinics,
    );
    expect(m.verdict).toBe("unmatched");
  });
});

describe("fuzzy primitives", () => {
  it("nameSimilarity ignores legal suffixes and punctuation", () => {
    expect(nameSimilarity("Granite City Physio Ltd.", "Granite City Physio")).toBeGreaterThan(0.95);
  });
  it("different clinics score low", () => {
    expect(nameSimilarity("Albion MSK Clinic", "Westbourne Osteopathy")).toBeLessThan(0.3);
  });
  it("clinicMatchScore caps at 1", () => {
    expect(
      clinicMatchScore(
        { name: "Albion MSK Clinic", postcode: "M3 4LQ" },
        { name: "Albion MSK Clinic", postcode: "M3 4LQ" },
      ),
    ).toBe(1);
  });
  it("verdict thresholds", () => {
    expect(verdictFor(0.9)).toBe("matched");
    expect(verdictFor(0.7)).toBe("ambiguous");
    expect(verdictFor(0.3)).toBe("unmatched");
  });
});

describe("CSV parser", () => {
  it("handles quoted fields with commas and escaped quotes", () => {
    const rows = parseCsv('id,name,notes\n1,"Smith, Jones & Co","He said ""hi""\nsecond line"');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Smith, Jones & Co");
    expect(rows[0].notes).toBe('He said "hi"\nsecond line');
  });
  it("trims headers and skips blank lines", () => {
    const rows = parseCsv("a, b \n1,2\n\n3,4\n");
    expect(rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });
});
