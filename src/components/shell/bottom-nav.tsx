"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MoreHorizontal, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import type { UserProfile } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import {
  NAV,
  BOTTOM_NAV_PRIMARY,
  SHORT_LABELS,
  isNavActive,
  type NavItem,
} from "./nav-items";

/**
 * Mobile-only bottom navigation (hidden at md+, where the sidebar takes over).
 * Four primary destinations plus a "More" sheet listing everything else.
 */
export function BottomNav({
  profile,
  reengageCount,
  unmatchedCount,
}: {
  profile: UserProfile;
  reengageCount: number;
  unmatchedCount: number;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const counts: Record<string, number> = {
    reengage: reengageCount,
    unmatched: unmatchedCount,
  };
  const countFor = (item: NavItem) => (item.badge ? counts[item.badge] ?? 0 : 0);

  const primarySet = new Set<string>(BOTTOM_NAV_PRIMARY);
  const visible = NAV.filter((item) => !item.adminOnly || profile.role === "admin");
  const primary = BOTTOM_NAV_PRIMARY.map((href) =>
    visible.find((item) => item.href === href),
  ).filter((item): item is NavItem => Boolean(item));
  const more = visible.filter((item) => !primarySet.has(item.href));

  // Surface hidden priority counts (e.g. Re-engage) on the More tab.
  const moreBadge = more.reduce((sum, item) => sum + countFor(item), 0);
  const moreActive = more.some((item) => isNavActive(pathname, item.href));

  const fmt = (n: number) => (n > 99 ? "99+" : String(n));

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="flex items-stretch">
          {primary.map((item) => {
            const active = isNavActive(pathname, item.href);
            const badge = countFor(item);
            const label = SHORT_LABELS[item.href] ?? item.label;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition-colors",
                  active ? "text-brand-700" : "text-slate-500 hover:text-slate-900",
                )}
              >
                <span className="relative">
                  <item.icon
                    className={cn("h-5 w-5", active ? "text-brand-600" : "text-slate-400")}
                  />
                  {badge > 0 ? (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
                      {fmt(badge)}
                    </span>
                  ) : null}
                </span>
                <span className="leading-none">{label}</span>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            className={cn(
              "relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition-colors",
              moreActive ? "text-brand-700" : "text-slate-500 hover:text-slate-900",
            )}
          >
            <span className="relative">
              <MoreHorizontal
                className={cn("h-5 w-5", moreActive ? "text-brand-600" : "text-slate-400")}
              />
              {moreBadge > 0 ? (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
                  {fmt(moreBadge)}
                </span>
              ) : null}
            </span>
            <span className="leading-none">More</span>
          </button>
        </div>
      </nav>

      <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px] md:hidden" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t bg-card pb-[env(safe-area-inset-bottom)] shadow-xl animate-sheet-up md:hidden"
          >
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-slate-300" />
            <div className="flex items-center justify-between px-4 pb-1 pt-2">
              <Dialog.Title className="text-sm font-semibold">Menu</Dialog.Title>
              <Dialog.Close
                aria-label="Close menu"
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
            <nav aria-label="More destinations" className="px-2 pb-3">
              {more.map((item) => {
                const active = isNavActive(pathname, item.href);
                const badge = countFor(item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                      active
                        ? "bg-brand-50 text-brand-800"
                        : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
                    )}
                  >
                    <item.icon
                      className={cn("h-5 w-5", active ? "text-brand-600" : "text-slate-400")}
                    />
                    <span className="flex-1">{item.label}</span>
                    {badge > 0 ? (
                      <Badge className="h-5 min-w-5 justify-center rounded-full bg-brand-600 px-1.5 text-[10px]">
                        {fmt(badge)}
                      </Badge>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
