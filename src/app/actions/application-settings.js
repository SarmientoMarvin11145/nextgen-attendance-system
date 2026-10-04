"use server";

import { revalidatePath } from "next/cache";
import { requireProfileRole } from "@/lib/auth/authorization";
import { applicationSettingsSchema } from "@/lib/auth/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function readString(formData, name) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function saveApplicationSettings(_previousState, formData) {
  await requireProfileRole(["admin"]);
  const values = {
    schoolTimezone: readString(formData, "schoolTimezone"),
    reminderMinutes: readString(formData, "reminderMinutes"),
  };
  const parsed = applicationSettingsSchema.safeParse(values);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message || "Review the settings." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("application_settings")
      .update({
        school_timezone: parsed.data.schoolTimezone,
        notify_attendance_open: formData.get("notifyAttendanceOpen") === "on",
        notify_attendance_reminder: formData.get("notifyAttendanceReminder") === "on",
        notify_attendance_closing: formData.get("notifyAttendanceClosing") === "on",
        reminder_minutes_before_close: parsed.data.reminderMinutes,
        notify_after_attendance: formData.get("notifyAfterAttendance") === "on",
      })
      .eq("id", true);

    if (error) return { status: "error", message: "Settings could not be saved. Try again." };
  } catch {
    return { status: "error", message: "We could not reach application settings. Try again." };
  }

  for (const path of ["/admin", "/admin/history", "/admin/reports", "/dashboard", "/notifications", "/attendance/session"] ) {
    revalidatePath(path);
  }

  return { status: "success", message: "Application settings saved." };
}