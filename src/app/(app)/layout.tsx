import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { Topbar } from "@/components/shell/topbar";
import { CommandPalette } from "@/components/shell/command-palette";
import { QuickLog } from "@/components/shell/quick-log";
import { TooltipProvider } from "@/components/ui/tooltip";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const inFourteenDays = new Date();
  inFourteenDays.setDate(inFourteenDays.getDate() + 14);

  const [{ count: reengageCount }, { count: unmatchedCount }] = await Promise.all([
    supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("pipeline_column", "reengage")
      .lte("reengage_on", inFourteenDays.toISOString().slice(0, 10)),
    supabase
      .from("unmatched_emails")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-screen">
        <Sidebar
          profile={profile}
          reengageCount={reengageCount ?? 0}
          unmatchedCount={unmatchedCount ?? 0}
        />
        <div className="flex min-w-0 flex-1 flex-col md:pl-56">
          <Topbar profile={profile} />
          <main className="flex-1 px-4 pt-5 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-6 md:py-5">
            {children}
          </main>
        </div>
        <BottomNav
          profile={profile}
          reengageCount={reengageCount ?? 0}
          unmatchedCount={unmatchedCount ?? 0}
        />
      </div>
      <CommandPalette />
      <QuickLog />
    </TooltipProvider>
  );
}
