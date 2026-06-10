/**
 * npm run smoke:staging [-- https://your-deployment.vercel.app]
 *
 * Proves a hosted environment is review-ready:
 *  1. signs in as admin@kinetico.test via Supabase Auth (anon key)
 *  2. checks the seed: deal counts per pipeline column, flagship deal,
 *     legal pack, viewer grant count
 *  3. (optional) fetches the deployed URL and confirms it redirects to /login
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY from
 * .env.local / the environment. Exits non-zero on any failure.
 */
import { createClient } from "@supabase/supabase-js";
import { config as dotenv } from "dotenv";

dotenv({ path: ".env.local", quiet: true });
dotenv({ path: ".env", quiet: true });

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY first.");
    process.exit(1);
  }

  console.log(`Supabase: ${url}`);
  const supabase = createClient(url, anonKey);

  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
    email: "admin@kinetico.test",
    password: "KineticoDemo1!",
  });
  check("admin@kinetico.test signs in", !!auth?.user && !authError, authError?.message);
  if (!auth?.user) process.exit(1);

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", auth.user.id)
    .single();
  check("admin profile + role resolves", profile?.role === "admin");

  const { count: dealCount } = await supabase
    .from("deals")
    .select("id", { count: "exact", head: true });
  check(`seed present: ${dealCount ?? 0} deals (expect ~31)`, (dealCount ?? 0) >= 25);

  const { data: columns } = await supabase.from("deals").select("pipeline_column");
  const distinct = new Set((columns ?? []).map((c) => c.pipeline_column));
  check(`all ten pipeline columns populated (${distinct.size}/10)`, distinct.size === 10);

  const { data: flagship } = await supabase
    .from("deals")
    .select("id, pipeline_column, tier, hots_signed_at")
    .eq("name", "Riverside Physio Group")
    .maybeSingle();
  check(
    "flagship in HoTs with signed date + persisted tier",
    flagship?.pipeline_column === "hots" && !!flagship?.hots_signed_at && !!flagship?.tier,
  );

  if (flagship) {
    const { count: docs } = await supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", flagship.id);
    check(`flagship legal pack spawned (${docs ?? 0} docs, expect 9)`, (docs ?? 0) >= 9);
  }

  const { count: clinicCount } = await supabase
    .from("clinics")
    .select("id", { count: "exact", head: true });
  check(`clinics seeded (${clinicCount ?? 0}, expect ~80)`, (clinicCount ?? 0) >= 75);

  await supabase.auth.signOut();

  // viewer sees exactly 2 deals
  const viewer = createClient(url, anonKey);
  const { data: viewerAuth } = await viewer.auth.signInWithPassword({
    email: "viewer@kinetico.test",
    password: "KineticoDemo1!",
  });
  if (viewerAuth?.user) {
    const { count: viewerDeals } = await viewer
      .from("deals")
      .select("id", { count: "exact", head: true });
    check(`viewer sees exactly 2 deals (saw ${viewerDeals})`, viewerDeals === 2);
    await viewer.auth.signOut();
  } else {
    check("viewer@kinetico.test signs in", false);
  }

  const deployedUrl = process.argv[2];
  if (deployedUrl) {
    const res = await fetch(deployedUrl, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    check(
      `deployed app up at ${deployedUrl} (redirects to /login)`,
      (res.status === 307 || res.status === 308 || res.status === 302) &&
        location.includes("/login"),
      `status ${res.status}, location ${location || "none"}`,
    );
    const login = await fetch(new URL("/login", deployedUrl));
    const html = await login.text();
    check("login page renders", login.ok && html.includes("Kinetico"));
  }

  console.log(failures === 0 ? "\n✓ staging smoke test passed" : `\n✗ ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
