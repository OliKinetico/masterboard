/** Companies House enrichment adapters (spec §5.8, §8). */

export interface ChCompanyInfo {
  companyNumber: string;
  lastAccountsMadeUpTo: string | null; // ISO date
  companyName: string | null;
}

export interface ChProvider {
  readonly name: string;
  getCompany(companyNumber: string): Promise<ChCompanyInfo | null>;
}

/**
 * Fixture provider (CH_PROVIDER=fixture, default): deterministic responses
 * for the seeded clinics. Two companies have filed NEWER accounts than the
 * CRM knows about → the enrichment run creates accounts_filed signals.
 */
export class FixtureChProvider implements ChProvider {
  readonly name = "fixture";

  private static FIXTURES: Record<string, { madeUpTo: string; name: string }> = {
    // newer than seeded ch_last_accounts_date → signal
    SC332871: { madeUpTo: "2026-04-30", name: "CALEDONIA PHYSIO PARTNERS LTD" }, // seeded 2025-08-31
    "07556012": { madeUpTo: "2026-05-31", name: "WESTBOURNE OSTEOPATHY LIMITED" }, // seeded 2025-06-30
    // unchanged → no signal
    "08412231": { madeUpTo: "2025-09-30", name: "RIVERSIDE PHYSIO GROUP LIMITED" },
    "10583321": { madeUpTo: "2025-12-31", name: "HARBORNE SPINE & SPORT LTD" },
    "11220987": { madeUpTo: "2025-10-31", name: "ALBION MSK CLINIC LIMITED" },
    "09887234": { madeUpTo: "2025-11-30", name: "THE PENNINE PHYSIO CO. LIMITED" },
  };

  async getCompany(companyNumber: string): Promise<ChCompanyInfo | null> {
    const hit = FixtureChProvider.FIXTURES[companyNumber];
    if (!hit) return null;
    return {
      companyNumber,
      lastAccountsMadeUpTo: hit.madeUpTo,
      companyName: hit.name,
    };
  }
}

/**
 * Real provider (CH_PROVIDER=api) — COMPLETE implementation, env-gated,
 * ⚠ UNTESTED AGAINST THE LIVE API. Companies House uses HTTP basic auth
 * with the API key as the username and an empty password.
 */
export class ApiChProvider implements ChProvider {
  readonly name = "api";

  async getCompany(companyNumber: string): Promise<ChCompanyInfo | null> {
    const apiKey = process.env.CH_API_KEY;
    if (!apiKey) throw new Error("ApiChProvider needs CH_API_KEY");
    const res = await fetch(
      `https://api.company-information.service.gov.uk/company/${encodeURIComponent(companyNumber)}`,
      { headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` } },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Companies House request failed: ${res.status}`);
    const json = (await res.json()) as {
      company_name?: string;
      accounts?: { last_accounts?: { made_up_to?: string } };
    };
    return {
      companyNumber,
      lastAccountsMadeUpTo: json.accounts?.last_accounts?.made_up_to ?? null,
      companyName: json.company_name ?? null,
    };
  }
}

export function getChProvider(): ChProvider {
  return (process.env.CH_PROVIDER ?? "fixture") === "api"
    ? new ApiChProvider()
    : new FixtureChProvider();
}
