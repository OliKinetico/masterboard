"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  KanbanSquare,
  Briefcase,
  Building2,
  Users,
  Scale,
  BarChart3,
  Settings,
  ClipboardCheck,
  RotateCcw,
  Inbox,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { UserProfile } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

const NAV = [
  { href: "/", label: "Pipeline", icon: KanbanSquare },
  { href: "/deals", label: "Deals", icon: Briefcase },
  { href: "/clinics", label: "Clinics", icon: Building2 },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/legal-board", label: "Legal Board", icon: Scale },
  { href: "/unmatched", label: "Unmatched Inbox", icon: Inbox, badge: "unmatched" },
  { href: "/reengage", label: "Re-engage", icon: RotateCcw, badge: "reengage" },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin", label: "Admin", icon: Settings, adminOnly: true },
  { href: "/review", label: "Review", icon: ClipboardCheck },
] as const;

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
  const [open, setOpen] = useState(false);

  const counts: Record<string, number> = {
    reengage: reengageCount,
    unmatched: unmatchedCount,
  };

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 px-3 py-3">
      {NAV.filter((item) => !("adminOnly" in item && item.adminOnly) || profile.role === "admin").map(
        (item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const badge = "badge" in item ? counts[item.badge] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
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
        },
      )}
    </nav>
  );

  return (
    <>
      {/* mobile trigger */}
      <button
        className="fixed left-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-md border bg-card shadow-sm lg:hidden"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-950/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-card shadow-xl">
            <div className="flex items-center justify-between px-4 py-3">
              <Brand />
              <button onClick={() => setOpen(false)} aria-label="Close navigation">
                <X className="h-4 w-4" />
              </button>
            </div>
            {nav}
          </div>
        </div>
      ) : null}

      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r bg-card lg:flex">
        <div className="flex items-center px-4 py-4">
          <Brand />
        </div>
        {nav}
        <div className="border-t px-4 py-3 text-[11px] text-muted-foreground">
          Kinetico Health · M&amp;A
        </div>
      </aside>
    </>
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
