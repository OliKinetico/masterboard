import type { Sql } from "postgres";
import { seedUsers } from "./users";
import { seedClinics } from "./clinics";
import { seedContacts } from "./contacts";
import { seedDeals } from "./deals";

/**
 * Deterministic seed (spec §7): 4 demo users, ~80 clinics, ~31 deals across
 * all ten pipeline columns, the fully-worked Riverside flagship, fixtures
 * that round-trip with the WhatsApp/email import demos.
 * Idempotent: every insert is keyed on a deterministic uuid + on conflict.
 */
export async function seed(sql: Sql) {
  await seedUsers(sql);
  const clinics = await seedClinics(sql);
  const fillers = clinics.filter((c) => c.key.startsWith("filler:"));
  await seedContacts(sql, fillers);
  await seedDeals(sql, fillers);

  const [{ count: dealCount }] = await sql`select count(*)::int as count from public.deals`;
  const [{ count: clinicCount }] = await sql`select count(*)::int as count from public.clinics`;
  const [{ count: interactionCount }] = await sql`select count(*)::int as count from public.interactions`;
  const [{ count: docCount }] = await sql`select count(*)::int as count from public.documents`;
  console.log(
    `  seeded: ${clinicCount} clinics, ${dealCount} deals, ${interactionCount} interactions, ${docCount} documents`,
  );
}
