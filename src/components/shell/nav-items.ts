import {
  KanbanSquare,
  Briefcase,
  Building2,
  Users,
  Scale,
  Inbox,
  RotateCcw,
  BarChart3,
  Settings,
  ClipboardCheck,
} from "lucide-react";
import type { ComponentType } from "react";

export type BadgeKey = "unmatched" | "reengage";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: BadgeKey;
  adminOnly?: boolean;
};

/** Full navigation, in display order. Shared by the desktop sidebar and the mobile bottom nav. */
export const NAV: NavItem[] = [
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
];

/**
 * Primary destinations pinned to the mobile bottom bar, in bar order.
 * Everything else falls into the "More" sheet.
 */
export const BOTTOM_NAV_PRIMARY = ["/", "/deals", "/clinics", "/unmatched"] as const;

/** Compact labels for the bottom bar, where horizontal room is tight. */
export const SHORT_LABELS: Record<string, string> = {
  "/": "Pipeline",
  "/deals": "Deals",
  "/clinics": "Clinics",
  "/unmatched": "Inbox",
};

/** Shared active-route test: exact match for the root, prefix match otherwise. */
export function isNavActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
