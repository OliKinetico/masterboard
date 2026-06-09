import type { Sql } from "postgres";
import { did, rng, pick, domainOf } from "./helpers";
import { cid, type ClinicSeed } from "./clinics";

export const pid = (key: string) => did(`contact:${key}`);

interface ContactSeed {
  key: string;
  clinic_key: string | null;
  full_name: string;
  role: string;
  emails: string[];
  phone?: string;
  whatsapp_number?: string;
  notes?: string;
}

/** Hand contacts — emails line up with the fixture mailbox + WhatsApp exports. */
export const HAND_CONTACTS: ContactSeed[] = [
  { key: "sarah", clinic_key: "riverside-richmond", full_name: "Sarah Whitfield", role: "owner",
    emails: ["sarah@riversidephysio.co.uk"], phone: "020 8940 1122",
    whatsapp_number: "+447700900123", notes: "Co-founder with Mark. Clinically active 3 days/week." },
  { key: "mark", clinic_key: "riverside-richmond", full_name: "Mark Whitfield", role: "director",
    emails: ["mark@riversidephysio.co.uk", "mark.whitfield@gmail.com"], phone: "020 8940 1123",
    whatsapp_number: "+447700900124", notes: "Handles the numbers. Prefers WhatsApp for quick questions." },
  { key: "james", clinic_key: "riverside-kingston", full_name: "James Okafor", role: "practice_manager",
    emails: ["james@riversidephysio.co.uk"], notes: "Runs ops across all three sites." },
  { key: "tom", clinic_key: null, full_name: "Tom Bryce", role: "adviser",
    emails: ["tom@brycecf.co.uk"], phone: "0117 332 8810",
    notes: "Bryce Corporate Finance — sell-side adviser on Riverside." },
  { key: "priya", clinic_key: null, full_name: "Priya Shah", role: "solicitor",
    emails: ["priya.shah@hartleylaw.co.uk"],
    notes: "Hartley Law — seller solicitors on Riverside (Project Thames)." },

  { key: "emma", clinic_key: "harborne", full_name: "Emma Carlton", role: "owner",
    emails: ["emma@harbornespinesport.co.uk"], whatsapp_number: "+447700900201",
    notes: "Chiropractor-owner. Wants 2 days/week clinical post-completion." },
  { key: "fraser", clinic_key: "caledonia", full_name: "Fraser McAllister", role: "director",
    emails: ["fraser@caledoniaphysio.co.uk"], whatsapp_number: "+447700900215",
    notes: "Two minority partners (10% each) to resolve in any structure." },
  { key: "dee", clinic_key: "albion", full_name: "Dee Adeyemi", role: "owner",
    emails: ["dee@albionmskclinic.co.uk"] },
  { key: "karen", clinic_key: "westbourne", full_name: "Karen Doyle", role: "owner",
    emails: ["karen@westbourneosteopathy.co.uk"] },
  { key: "joe", clinic_key: "pennine", full_name: "Joe Hartley", role: "owner",
    emails: ["joe@thepenninephysioco.co.uk"] },
  { key: "beth", clinic_key: "cathedral", full_name: "Beth Lloyd", role: "owner",
    emails: ["beth@cathedralphysiotherapy.co.uk"] },
  { key: "stuart", clinic_key: "granite", full_name: "Stuart Milne", role: "owner",
    emails: ["stuart@granitecityphysio.co.uk"] },
  { key: "gemma", clinic_key: "severn", full_name: "Gemma Price", role: "owner",
    emails: ["gemma@severnsportstherapy.co.uk"], whatsapp_number: "+447700900230" },
  { key: "aaron", clinic_key: "maple", full_name: "Aaron Kemp", role: "owner",
    emails: ["aaron@maplehousechiropractic.co.uk"] },
];

const FIRST = ["Alex", "Sam", "Jordan", "Casey", "Robin", "Jamie", "Morgan", "Taylor",
  "Nicola", "Owen", "Rachel", "Paul", "Helen", "David", "Susan", "Gareth", "Fiona", "Neil"];
const LAST = ["Adams", "Bennett", "Clarke", "Dawson", "Ellis", "Fletcher", "Graham",
  "Hughes", "Irwin", "Jenkins", "Knight", "Lawson", "Mason", "Newton", "Osborne", "Parker"];

export async function seedContacts(sql: Sql, fillerClinics: ClinicSeed[]) {
  for (const c of HAND_CONTACTS) {
    await sql`
      insert into public.contacts (id, clinic_id, full_name, role, emails, phone, whatsapp_number, notes)
      values (
        ${pid(c.key)}, ${c.clinic_key ? cid(c.clinic_key) : null}, ${c.full_name},
        ${c.role}::contact_role, ${c.emails}, ${c.phone ?? null},
        ${c.whatsapp_number ?? null}, ${c.notes ?? null}
      ) on conflict (id) do nothing`;
  }

  // one owner contact for ~70% of filler clinics
  const r = rng(987654);
  for (const clinic of fillerClinics) {
    if (r() < 0.3) continue;
    const name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
    const email = `${name.split(" ")[0].toLowerCase()}@${domainOf(clinic.name)}`;
    await sql`
      insert into public.contacts (id, clinic_id, full_name, role, emails)
      values (
        ${pid(`filler:${clinic.key}`)}, ${cid(clinic.key)}, ${name},
        'owner'::contact_role, ${[email]}
      ) on conflict (id) do nothing`;
  }
}
