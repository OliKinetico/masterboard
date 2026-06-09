/**
 * npm run db:reset — drop & recreate the public schema, apply every
 * migration in /supabase/migrations in filename order, then seed.
 *
 * Works against BOTH:
 *  - Supabase local (default DATABASE_URL postgres://postgres:postgres@127.0.0.1:54322/postgres)
 *  - plain Postgres (the auth shim in scripts/pg-local-shim.sql is applied
 *    automatically when no auth schema exists)
 *
 * Flags: --schema-only (skip seed), --seed-only (skip drop+migrate)
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { config as dotenv } from "dotenv";
import { seed } from "./seed/index";

dotenv({ path: ".env.local" });
dotenv({ path: ".env" });

export const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:54322/postgres";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

async function main() {
  const schemaOnly = process.argv.includes("--schema-only");
  const seedOnly = process.argv.includes("--seed-only");

  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

  try {
    if (!seedOnly) {
      const [{ exists: hasAuth }] = await sql`
        select exists(
          select 1 from information_schema.schemata where schema_name = 'auth'
        )`;
      if (!hasAuth) {
        console.log("→ no auth schema found: applying plain-Postgres shim");
        await sql.unsafe(
          readFileSync(path.join(process.cwd(), "scripts", "pg-local-shim.sql"), "utf8"),
        );
      }

      console.log("→ dropping public schema");
      await sql.unsafe(`
        drop schema if exists public cascade;
        create schema public;
        grant usage on schema public to anon, authenticated, service_role;
        grant all on schema public to postgres, service_role;
        alter default privileges in schema public
          grant all on tables to anon, authenticated, service_role;
        alter default privileges in schema public
          grant all on sequences to anon, authenticated, service_role;
        alter default privileges in schema public
          grant execute on functions to anon, authenticated, service_role;
      `);

      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      for (const file of files) {
        console.log(`→ applying ${file}`);
        await sql.unsafe(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
      }

      // tables created by migrations need explicit grants too
      await sql.unsafe(`
        grant all on all tables in schema public to anon, authenticated, service_role;
        grant all on all sequences in schema public to anon, authenticated, service_role;
        grant execute on all functions in schema public to anon, authenticated, service_role;
      `);
    }

    if (!schemaOnly) {
      console.log("→ seeding");
      await seed(sql);
    }

    console.log("✓ done");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
