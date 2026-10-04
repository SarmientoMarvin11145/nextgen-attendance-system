import WorkspaceShell from "@/components/workspace-shell";
import { requireAuthenticatedProfile } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function WorkspaceLayout({ children }) {
  const profile = await requireAuthenticatedProfile();
  const supabase = await createSupabaseServerClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", profile.id)
    .eq("is_read", false);

  return <WorkspaceShell role={profile.role} unreadNotificationCount={count ?? 0}>{children}</WorkspaceShell>;
}