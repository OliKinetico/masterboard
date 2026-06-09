import type { Sql } from "postgres";
import { did, rng, pick, domainOf } from "./helpers";

export interface ClinicSeed {
  key: string; // stable seed key → deterministic uuid
  name: string;
  trading_name?: string;
  address_line1: string;
  city: string;
  postcode: string;
  region: string;
  lat: number;
  lng: number;
  companies_house_number?: string;
  disciplines: string[];
  revenue_estimate: number;
  practitioner_count: number;
  sites_count?: number;
  score: number;
  ch_last_accounts_date?: string;
}

export const cid = (key: string) => did(`clinic:${key}`);

/** Hand-authored clinics — every late-stage deal and email fixture points here. */
export const HAND_CLINICS: ClinicSeed[] = [
  // flagship group — Riverside Physio (3 sites, one deal)
  { key: "riverside-richmond", name: "Riverside Physio — Richmond", trading_name: "Riverside Physio",
    address_line1: "14 Thames Quay", city: "Richmond", postcode: "TW9 1HH", region: "London",
    lat: 51.461, lng: -0.304, companies_house_number: "08412231",
    disciplines: ["Physio"], revenue_estimate: 720000, practitioner_count: 9, score: 92,
    ch_last_accounts_date: "2025-09-30" },
  { key: "riverside-kingston", name: "Riverside Physio — Kingston", trading_name: "Riverside Physio",
    address_line1: "3 Market Place", city: "Kingston upon Thames", postcode: "KT1 1JT", region: "London",
    lat: 51.409, lng: -0.306, companies_house_number: "08412231",
    disciplines: ["Physio"], revenue_estimate: 540000, practitioner_count: 7, score: 90,
    ch_last_accounts_date: "2025-09-30" },
  { key: "riverside-putney", name: "Riverside Physio — Putney", trading_name: "Riverside Physio",
    address_line1: "88 Lower Richmond Road", city: "Putney", postcode: "SW15 1LN", region: "London",
    lat: 51.466, lng: -0.221, companies_house_number: "08412231",
    disciplines: ["Physio", "Podiatry"], revenue_estimate: 360000, practitioner_count: 5, score: 88,
    ch_last_accounts_date: "2025-09-30" },

  { key: "harborne", name: "Harborne Spine & Sport", address_line1: "212 High Street",
    city: "Birmingham", postcode: "B17 9PT", region: "West Midlands", lat: 52.460, lng: -1.949,
    companies_house_number: "10583321", disciplines: ["Chiro", "Physio"],
    revenue_estimate: 880000, practitioner_count: 11, score: 86, ch_last_accounts_date: "2025-12-31" },
  { key: "caledonia", name: "Caledonia Physio Partners", address_line1: "41 Constitution Street",
    city: "Edinburgh", postcode: "EH6 7BG", region: "Scotland", lat: 55.974, lng: -3.170,
    companies_house_number: "SC332871", disciplines: ["Physio"],
    revenue_estimate: 1150000, practitioner_count: 14, score: 84, sites_count: 2,
    ch_last_accounts_date: "2025-08-31" },
  { key: "albion", name: "Albion MSK Clinic", address_line1: "9 Deansgate Mews",
    city: "Manchester", postcode: "M3 4LQ", region: "North West", lat: 53.479, lng: -2.249,
    companies_house_number: "11220987", disciplines: ["Physio", "Osteo"],
    revenue_estimate: 640000, practitioner_count: 8, score: 81, ch_last_accounts_date: "2025-10-31" },
  { key: "westbourne", name: "Westbourne Osteopathy", address_line1: "5 Poole Hill",
    city: "Bournemouth", postcode: "BH2 5PS", region: "South West", lat: 50.719, lng: -1.887,
    companies_house_number: "07556012", disciplines: ["Osteo"],
    revenue_estimate: 420000, practitioner_count: 6, score: 78, ch_last_accounts_date: "2025-06-30" },
  { key: "pennine", name: "The Pennine Physio Co.", address_line1: "27 Otley Road",
    city: "Leeds", postcode: "LS6 3AA", region: "Yorkshire", lat: 53.820, lng: -1.577,
    companies_house_number: "09887234", disciplines: ["Physio"],
    revenue_estimate: 530000, practitioner_count: 7, score: 74, ch_last_accounts_date: "2025-11-30" },
  { key: "cathedral", name: "Cathedral Physiotherapy", address_line1: "2 Cathedral Yard",
    city: "Exeter", postcode: "EX1 1HJ", region: "South West", lat: 50.722, lng: -3.530,
    companies_house_number: "06743110", disciplines: ["Physio"],
    revenue_estimate: 610000, practitioner_count: 8, score: 80, ch_last_accounts_date: "2025-07-31" },
  { key: "granite", name: "Granite City Physio", address_line1: "118 Union Street",
    city: "Aberdeen", postcode: "AB10 1QR", region: "Scotland", lat: 57.146, lng: -2.106,
    companies_house_number: "SC401177", disciplines: ["Physio"],
    revenue_estimate: 350000, practitioner_count: 5, score: 60, ch_last_accounts_date: "2025-05-31" },
  { key: "severn", name: "Severn Sports Therapy", address_line1: "Unit 4, Docks Way",
    city: "Gloucester", postcode: "GL1 2EH", region: "South West", lat: 51.862, lng: -2.249,
    companies_house_number: "12099813", disciplines: ["Physio", "Other"],
    revenue_estimate: 470000, practitioner_count: 6, score: 72, ch_last_accounts_date: "2026-01-31" },
  { key: "maple", name: "Maple House Chiropractic", address_line1: "61 Mansfield Road",
    city: "Nottingham", postcode: "NG1 3FN", region: "East Midlands", lat: 52.958, lng: -1.150,
    companies_house_number: "10778452", disciplines: ["Chiro"],
    revenue_estimate: 380000, practitioner_count: 4, score: 69, ch_last_accounts_date: "2025-10-31" },
];

const TOWNS: Array<[city: string, pc: string, region: string, lat: number, lng: number]> = [
  ["Bristol", "BS8", "South West", 51.46, -2.61], ["Bath", "BA1", "South West", 51.38, -2.36],
  ["Reading", "RG1", "South East", 51.45, -0.97], ["Guildford", "GU1", "South East", 51.24, -0.57],
  ["Brighton", "BN1", "South East", 50.82, -0.14], ["Cambridge", "CB1", "East of England", 52.20, 0.13],
  ["Norwich", "NR2", "East of England", 52.63, 1.29], ["Ipswich", "IP1", "East of England", 52.06, 1.15],
  ["Leicester", "LE1", "East Midlands", 52.63, -1.13], ["Derby", "DE1", "East Midlands", 52.92, -1.47],
  ["Coventry", "CV1", "West Midlands", 52.41, -1.51], ["Wolverhampton", "WV1", "West Midlands", 52.59, -2.13],
  ["Sheffield", "S1", "Yorkshire", 53.38, -1.47], ["York", "YO1", "Yorkshire", 53.96, -1.08],
  ["Hull", "HU1", "Yorkshire", 53.74, -0.34], ["Newcastle", "NE1", "North East", 54.97, -1.61],
  ["Durham", "DH1", "North East", 54.78, -1.58], ["Liverpool", "L1", "North West", 53.41, -2.98],
  ["Preston", "PR1", "North West", 53.76, -2.70], ["Chester", "CH1", "North West", 53.19, -2.89],
  ["Glasgow", "G1", "Scotland", 55.86, -4.25], ["Dundee", "DD1", "Scotland", 56.46, -2.97],
  ["Cardiff", "CF10", "Wales", 51.48, -3.18], ["Swansea", "SA1", "Wales", 51.62, -3.94],
  ["Belfast", "BT1", "Northern Ireland", 54.60, -5.93], ["London", "N1", "London", 51.54, -0.10],
  ["London", "SE22", "London", 51.45, -0.07], ["Croydon", "CR0", "London", 51.37, -0.10],
];

const NAME_A = [
  "Apex", "Vital", "Motion", "Restore", "Summit", "Anchor", "Beacon", "Northgate",
  "Oakfield", "Stonebridge", "Hartwell", "Elmwood", "Fairview", "Kingsway", "Lakeside",
  "Meadow", "Quayside", "Redwood", "Silverdale", "Trinity", "Waverley", "Birchwood",
  "Clearwater", "Foxglove", "Greenway", "Hawthorn", "Ironbridge", "Juniper",
];
const NAME_B: Array<[suffix: string, discipline: string]> = [
  ["Physiotherapy", "Physio"], ["Physio Clinic", "Physio"], ["Sports Physio", "Physio"],
  ["Chiropractic", "Chiro"], ["Chiropractic Clinic", "Chiro"],
  ["Osteopathy", "Osteo"], ["Osteopathic Practice", "Osteo"],
  ["Podiatry", "Podiatry"], ["Foot & Ankle Clinic", "Podiatry"],
  ["MSK Clinic", "Physio"], ["Rehab Centre", "Other"], ["Health Clinic", "Other"],
];

export function generateFillerClinics(count: number): ClinicSeed[] {
  const r = rng(20260609);
  const seen = new Set<string>(HAND_CLINICS.map((c) => c.name));
  const out: ClinicSeed[] = [];
  while (out.length < count) {
    const a = pick(r, NAME_A);
    const [suffix, primaryDisc] = pick(r, NAME_B);
    const name = `${a} ${suffix}`;
    if (seen.has(name)) continue;
    seen.add(name);
    const [city, pc, region, lat, lng] = pick(r, TOWNS);
    const revenue = Math.round((150_000 + r() * 2_350_000) / 10_000) * 10_000;
    const practitioners = Math.max(2, Math.round(revenue / 90_000));
    const disciplines =
      r() < 0.25 && primaryDisc !== "Other"
        ? [primaryDisc, pick(r, ["Physio", "Podiatry", "Other"])]
        : [primaryDisc];
    out.push({
      key: `filler:${name}`,
      name,
      address_line1: `${Math.floor(r() * 200) + 1} ${pick(r, ["High Street", "Station Road", "Church Lane", "Market Square", "Victoria Road", "Mill Lane"])}`,
      city,
      postcode: `${pc} ${Math.floor(r() * 9) + 1}${pick(r, ["AA", "BB", "DX", "EH", "JL", "PR", "TQ"])}`,
      region,
      lat: lat + (r() - 0.5) * 0.08,
      lng: lng + (r() - 0.5) * 0.08,
      companies_house_number: r() < 0.8 ? String(6_000_000 + Math.floor(r() * 7_000_000)).padStart(8, "0") : undefined,
      disciplines: [...new Set(disciplines)],
      revenue_estimate: revenue,
      practitioner_count: practitioners,
      score: Math.round(30 + r() * 65),
      ch_last_accounts_date: r() < 0.7 ? `2025-${String(Math.floor(r() * 12) + 1).padStart(2, "0")}-28` : undefined,
    });
  }
  return out;
}

export async function seedClinics(sql: Sql): Promise<ClinicSeed[]> {
  const all = [...HAND_CLINICS, ...generateFillerClinics(68)];
  for (const c of all) {
    await sql`
      insert into public.clinics (
        id, name, trading_name, address_line1, city, postcode, region, lat, lng,
        companies_house_number, website, phone, disciplines, revenue_estimate,
        practitioner_count, sites_count, score, source, ch_last_accounts_date
      ) values (
        ${cid(c.key)}, ${c.name}, ${c.trading_name ?? null}, ${c.address_line1},
        ${c.city}, ${c.postcode}, ${c.region}, ${c.lat}, ${c.lng},
        ${c.companies_house_number ?? null},
        ${"https://www." + domainOf(c.name)}, null,
        ${c.disciplines}, ${c.revenue_estimate}, ${c.practitioner_count},
        ${c.sites_count ?? 1}, ${c.score},
        ${c.key.startsWith("filler:") ? "platform_import" : "manual"},
        ${c.ch_last_accounts_date ?? null}
      )
      on conflict (id) do nothing`;

    // alias seeding: full name + a shortened form without the legal suffix
    const aliases = new Set<string>([c.name]);
    const short = c.name
      .replace(/ — .+$/, "")
      .replace(/\b(Clinic|Centre|Practice|Co\.|Partners|Group)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (short.length > 4) aliases.add(short);
    if (c.trading_name) aliases.add(c.trading_name);
    for (const alias of aliases) {
      await sql`
        insert into public.clinic_aliases (clinic_id, alias)
        values (${cid(c.key)}, ${alias})
        on conflict (clinic_id, alias) do nothing`;
    }
  }
  return all;
}
