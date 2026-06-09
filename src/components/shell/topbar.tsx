"use client";

import { useRouter } from "next/navigation";
import { Search, Plus, LogOut, Phone, StickyNote, Users as UsersIcon, Briefcase, Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { UserProfile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/avatar";
import { RoleBadge } from "@/components/chips";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { openPalette, openQuickLog } from "./bus";

export function Topbar({ profile }: { profile: UserProfile }) {
  const router = useRouter();
  const staff = profile.role === "admin" || profile.role === "deal_lead";

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-card/80 px-4 backdrop-blur lg:px-6">
      <div className="w-8 lg:hidden" />
      <button
        onClick={() => openPalette()}
        className="flex h-9 flex-1 max-w-md items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-slate-100 cursor-pointer"
        data-testid="global-search"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search deals, clinics, contacts…</span>
        <kbd className="hidden rounded border bg-card px-1.5 py-0.5 text-[10px] font-medium sm:inline">
          ⌘K
        </kbd>
      </button>

      <div className="flex-1" />

      {staff ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" data-testid="quick-add">
              <Plus />
              <span className="hidden sm:inline">Quick add</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => openQuickLog()}>
              <Phone /> Log call / meeting
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openQuickLog("note")}>
              <StickyNote /> Quick note
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/deals?new=1")}>
              <Briefcase /> New deal
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/clinics?new=1")}>
              <Building2 /> New clinic
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/contacts?new=1")}>
              <UsersIcon /> New contact
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger className="cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <UserAvatar name={profile.full_name} className="h-8 w-8" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex items-center justify-between gap-2">
            <span className="truncate text-foreground">{profile.full_name}</span>
            <RoleBadge role={profile.role} />
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
