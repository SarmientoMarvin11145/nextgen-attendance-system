import Link from "next/link";
import NotificationSettings from "@/components/notifications/notification-settings";
import { requireAuthenticatedProfile } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const defaultPreferences = {
  attendance_open: true,
  attendance_reminder: true,
  attendance_closing: true,
  attendance_recorded: true,
  system_notifications: true,
};

export default async function NotificationSettingsPage() {
  const profile = await requireAuthenticatedProfile();
  const supabase = await createSupabaseServerClient();
  const [preferencesResult, subscriptionsResult] = await Promise.all([
    supabase
      .from("notification_preferences")
      .select("attendance_open, attendance_reminder, attendance_closing, attendance_recorded, system_notifications")
      .eq("user_id", profile.id)
      .maybeSingle(),
    supabase
      .from("push_subscriptions")
      .select("id, device_name, user_agent, created_at, last_used_at")
      .eq("user_id", profile.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="page-content notification-settings-page">
      <section className="page-heading" aria-labelledby="notification-settings-title">
        <div>
          <p className="eyebrow">Your account</p>
          <h1 className="page-title" id="notification-settings-title">Notification Settings</h1>
          <p className="page-description">Manage browser devices and attendance notification preferences.</p>
        </div>
        <Link className="topbar-primary history-back-link" href="/notifications">Back to notifications</Link>
      </section>
      <NotificationSettings
        preferences={{ ...defaultPreferences, ...preferencesResult.data }}
        devices={subscriptionsResult.data ?? []}
        pushConfigured={Boolean(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
          && process.env.VAPID_PRIVATE_KEY
          && process.env.VAPID_SUBJECT
          && process.env.PUSH_CRON_SECRET
          && process.env.SUPABASE_SERVICE_ROLE_KEY
        )}
      />
    </div>
  );
}