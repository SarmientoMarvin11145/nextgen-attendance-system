import Link from "next/link";
import ApplicationSettingsForm from "@/components/admin/application-settings-form";
import { requireProfileRole } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminSettingsPage() {
  await requireProfileRole(["admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: settings, error } = await supabase
    .from("application_settings")
    .select("school_timezone, notify_attendance_open, notify_attendance_reminder, notify_attendance_closing, reminder_minutes_before_close, notify_after_attendance")
    .eq("id", true)
    .maybeSingle();

  return (
    <div className="page-content admin-settings-page">
      <section className="page-heading" aria-labelledby="admin-settings-title">
        <div>
          <p className="eyebrow">System settings</p>
          <h1 className="page-title" id="admin-settings-title">Settings</h1>
          <p className="page-description">Attendance location, timezone, and notification controls.</p>
        </div>
        <Link className="topbar-primary history-back-link" href="/admin#dashboard">Dashboard</Link>
      </section>
      <nav className="admin-settings-links" aria-label="Settings sections">
        <Link className="admin-settings-link" href="/admin/settings/gates">
          <strong>Attendance Gates</strong>
          <span>Manage active entrances, radii, and boundary settings.</span>
        </Link>
      </nav>
      {error || !settings ? (
        <p className="form-feedback form-feedback-error" role="alert">Application settings are unavailable. Apply the application settings migration first.</p>
      ) : (
        <section className="panel application-settings-panel">
          <ApplicationSettingsForm settings={{
            school_timezone: settings.school_timezone,
            notifyAttendanceOpen: settings.notify_attendance_open,
            notifyAttendanceReminder: settings.notify_attendance_reminder,
            notifyAttendanceClosing: settings.notify_attendance_closing,
            reminder_minutes_before_close: settings.reminder_minutes_before_close,
            notifyAfterAttendance: settings.notify_after_attendance,
          }} />
        </section>
      )}
    </div>
  );
}