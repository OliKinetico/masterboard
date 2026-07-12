"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserProfile } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { NAV, isNavActive } from "./nav-items";

export function Sidebar({
  profile,
  reengageCount,
  unmatchedCount,
}: {
  profile: UserProfile;
  reengageCount: number;
  unmatchedCount: number;
}) {
  const pathname = usePathname();

  const counts: Record<string, number> = {
    reengage: reengageCount,
    unmatched: unmatchedCount,
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r bg-card md:flex">
      <div className="flex items-center px-4 py-4">
        <Brand />
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-3">
        {NAV.filter((item) => !item.adminOnly || profile.role === "admin").map((item) => {
          const active = isNavActive(pathname, item.href);
          const badge = item.badge ? counts[item.badge] ?? 0 : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-50 text-brand-800"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <item.icon
                className={cn("h-4 w-4", active ? "text-brand-600" : "text-slate-400")}
              />
              <span className="flex-1">{item.label}</span>
              {badge > 0 ? (
                <Badge className="h-5 min-w-5 justify-center rounded-full bg-brand-600 px-1.5 text-[10px]">
                  {badge}
                </Badge>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="border-t px-4 py-3 text-[11px] text-muted-foreground">
        Kinetico Health · M&amp;A
      </div>
    </aside>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white">
        <Activity className="h-4 w-4" />
      </div>
      <span className="text-sm font-semibold tracking-tight">Kinetico M&amp;A</span>
    </Link>
  );
}
