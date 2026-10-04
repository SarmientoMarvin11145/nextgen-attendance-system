"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedProfile } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const notificationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function refreshNotificationViews() {
  revalidatePath("/notifications");
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

export async function markNotificationRead(formData) {
  const profile = await requireAuthenticatedProfile();
  const id = formData.get("notificationId");

  if (typeof id !== "string" || !notificationIdPattern.test(id)) {
    return;
  }

  const supabase = await createSupabaseServerClient();
  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", id)
    .eq("user_id", profile.id);

  refreshNotificationViews();
}

export async function markAllNotificationsRead() {
  const profile = await requireAuthenticatedProfile();
  const supabase = await createSupabaseServerClient();

  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", profile.id)
    .eq("is_read", false);

  refreshNotificationViews();
}