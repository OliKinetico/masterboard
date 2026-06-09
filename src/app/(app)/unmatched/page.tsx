import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isStaff } from "@/lib/auth";
import { UnmatchedInbox } from "@/components/email/unmatched-inbox";

export const metadata = { title: "Unmatched Inbox" };
export const dynamic = "force-dynamic";

export default async function UnmatchedPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const [{ data: emails }, { data: lastRun }] = await Promise.all([
    supabase
      .from("unmatched_emails")
      .select("*")
      .eq("status", "pending")
      .order("received_at", { ascending: false }),
    supabase
      .from("sync_runs")
      .select("started_at, finished_at, status, counts, error")
      .eq("source", "outlook")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return (
    <UnmatchedInbox
      emails={emails ?? []}
      lastRun={lastRun}
      canAct={isStaff(profile)}
    />
  );
}
