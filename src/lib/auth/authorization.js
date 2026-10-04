import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requireAuthenticatedProfile({ loginRedirect = "/login" } = {}) {
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;

  if (!userId) {
    redirect(loginRedirect);
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();

  if (error || !profile) {
    redirect("/login?error=profile");
  }

  return {
    ...profile,
    email: typeof claims?.claims?.email === "string" ? claims.claims.email : "",
  };
}

export async function requireProfileRole(allowedRoles, options) {
  const profile = await requireAuthenticatedProfile(options);

  if (!allowedRoles.includes(profile.role)) {
    redirect("/unauthorized");
  }

  return profile;
}