import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/lib/types";

/** Current user + profile, cached per request. Redirects to /login if absent. */
export const getCurrentProfile = cache(async (): Promise<UserProfile> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("user_id, full_name, role")
    .eq("user_id", user.id)
    .single();

  if (!profile) redirect("/login");
  return profile as UserProfile;
});

export function isStaff(profile: UserProfile): boolean {
  return profile.role === "admin" || profile.role === "deal_lead";
}
