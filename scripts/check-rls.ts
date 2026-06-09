/**
 * npm run check:rls — scripted proof of the RLS matrix (spec §4.11).
 * Impersonates each seeded role by switching to the `authenticated` Postgres
 * role and setting the same request.jwt.claims GUC Supabase sets, then
 * asserts what each role can and cannot see/do. Exits non-zero on failure.
 */
import postgres from "postgres";
import { config as dotenv } from "dotenv";
import { USERS } from "./seed/users";

dotenv({ path: ".env.local", quiet: true });
dotenv({ path: ".env", quiet: true });

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:54322/postgres";

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function asUser<T>(
  sql: postgres.Sql,
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role authenticated`);
    await tx.unsafe(
      `select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role: "authenticated" })}', true)`,
    );
    const result = await fn(tx);
    await tx.unsafe(`reset role`);
    return result;
  }) as Promise<T>;
}

async function expectError(p: Promise<unknown>): Promise<boolean> {
  try {
    await p;
    return false;
  } catch {
    return true;
  }
}

async function main() {
  const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const [{ count: totalDeals }] =
      await sql`select count(*)::int as count from public.deals`;
    const [{ id: someDealId }] =
      await sql`select id from public.deals where name = 'Riverside Physio Group'`;
    const [{ id: ungrantedDealId }] =
      await sql`select id from public.deals where name = 'Caledonia Physio Partners'`;

    console.log("admin:");
    await asUser(sql, USERS.admin.id, async (tx) => {
      const deals = await tx`select count(*)::int as count from public.deals`;
      check("reads all deals", deals[0].count === totalDeals);
      const upd = await tx`update public.column_settings set probability = probability
        where pipeline_column = 'hots' returning pipeline_column`;
      check("can update column_settings", upd.length === 1);
    });

    console.log("deal_lead:");
    await asUser(sql, USERS.lead.id, async (tx) => {
      const deals = await tx`select count(*)::int as count from public.deals`;
      check("reads all deals", deals[0].count === totalDeals);
      const ins = await tx`insert into public.interactions
        (deal_id, occurred_on, type, summary, source)
        values (${someDealId}, current_date, 'note', 'RLS check note', 'manual')
        returning id`;
      check("can write interactions", ins.length === 1);
      await tx`delete from public.interactions where id = ${ins[0].id}`;
    });
    check(
      "cannot edit column_settings (admin-only)",
      await expectError(
        asUser(sql, USERS.lead.id, async (tx) => {
          const r = await tx`update public.column_settings set probability = 0.5
            where pipeline_column = 'hots' returning pipeline_column`;
          if (r.length === 0) throw new Error("0 rows — blocked by RLS");
        }),
      ),
    );

    console.log("exec:");
    await asUser(sql, USERS.exec.id, async (tx) => {
      const deals = await tx`select count(*)::int as count from public.deals`;
      check("reads all deals", deals[0].count === totalDeals);
      const c = await tx`insert into public.comments (deal_id, author_user_id, body)
        values (${someDealId}, ${USERS.exec.id}, 'RLS check comment') returning id`;
      check("can write comments", c.length === 1);
      await tx`delete from public.comments where id = ${c[0].id}`;
    });
    check(
      "cannot write deals",
      await expectError(
        asUser(sql, USERS.exec.id, async (tx) => {
          const r = await tx`update public.deals set next_action = 'hax'
            where id = ${someDealId} returning id`;
          if (r.length === 0) throw new Error("0 rows — blocked by RLS");
        }),
      ),
    );
    check(
      "cannot write interactions",
      await expectError(
        asUser(sql, USERS.exec.id, async (tx) => {
          await tx`insert into public.interactions (deal_id, occurred_on, type, summary)
            values (${someDealId}, current_date, 'note', 'exec hax')`;
        }),
      ),
    );

    console.log("viewer:");
    await asUser(sql, USERS.viewer.id, async (tx) => {
      const deals = await tx`select name from public.deals order by name`;
      check(
        "sees exactly 2 granted deals",
        deals.length === 2,
        `saw ${deals.length}: ${deals.map((d) => d.name).join(", ")}`,
      );
      const hidden = await tx`select count(*)::int as count from public.deals
        where id = ${ungrantedDealId}`;
      check("ungranted deal invisible", hidden[0].count === 0);
      const docs = await tx`select count(*)::int as count from public.documents
        where deal_id = ${ungrantedDealId}`;
      check("ungranted child rows invisible", docs[0].count === 0);
      const granted = await tx`select count(*)::int as count from public.interactions
        where deal_id = ${someDealId}`;
      check("granted deal child rows visible", granted[0].count > 0);
    });
    check(
      "viewer cannot write anything",
      await expectError(
        asUser(sql, USERS.viewer.id, async (tx) => {
          await tx`insert into public.comments (deal_id, author_user_id, body)
            values (${someDealId}, ${USERS.viewer.id}, 'viewer hax')`;
        }),
      ),
    );

    console.log(failures === 0 ? "\n✓ all RLS checks passed" : `\n✗ ${failures} failures`);
    process.exit(failures === 0 ? 0 : 1);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
