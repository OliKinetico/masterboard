import type { Sql } from "postgres";
import { did } from "./helpers";

export const DEMO_PASSWORD = "KineticoDemo1!";

export const USERS = {
  admin: { id: did("user:admin"), email: "admin@kinetico.test", name: "Oli (Director of M&A)", role: "admin" },
  lead: { id: did("user:lead"), email: "lead@kinetico.test", name: "Dan Mercer", role: "deal_lead" },
  exec: { id: did("user:exec"), email: "exec@kinetico.test", name: "Claire Voss", role: "exec" },
  viewer: { id: did("user:viewer"), email: "viewer@kinetico.test", name: "Priti Rao", role: "viewer" },
} as const;

/**
 * Seed the four demo logins straight into auth.users (the standard Supabase
 * local-dev pattern — ASSUMPTIONS #3) plus their user_profiles rows.
 */
export async function seedUsers(sql: Sql) {
  for (const u of Object.values(USERS)) {
    await sql`
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
      ) values (
        '00000000-0000-0000-0000-000000000000', ${u.id}, 'authenticated',
        'authenticated', ${u.email}, crypt(${DEMO_PASSWORD}, gen_salt('bf')),
        now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        now(), now()
      )
      on conflict (id) do nothing`;

    await sql`
      insert into auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) values (
        ${did(`identity:${u.email}`)}, ${u.id},
        ${sql.json({ sub: u.id, email: u.email, email_verified: true })},
        'email', ${u.id}, now(), now(), now()
      )
      on conflict (id) do nothing`;

    await sql`
      insert into public.user_profiles (user_id, full_name, role)
      values (${u.id}, ${u.name}, ${u.role})
      on conflict (user_id) do update set full_name = excluded.full_name, role = excluded.role`;
  }
}
