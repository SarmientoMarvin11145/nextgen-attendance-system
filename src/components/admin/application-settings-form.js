"use client";

import { useActionState } from "react";
import { saveApplicationSettings } from "@/app/actions/application-settings";
import FormFeedback from "@/components/auth/form-feedback";

const initialState = { status: "idle", message: "" };

const notificationControls = [
  ["notifyAttendanceOpen", "Notify students when attendance starts"],
  ["notifyAttendanceReminder", "Send attendance reminder"],
  ["notifyAttendanceClosing", "Send attendance closing alert"],
  ["notifyAfterAttendance", "Notify after attendance is recorded"],
];

export default function ApplicationSettingsForm({ settings }) {
  const [state, action, isPending] = useActionState(saveApplicationSettings, initialState);

  return (
    <form className="application-settings-form" action={action}>
      <section className="application-settings-group" aria-labelledby="school-timezone-title">
        <div>
          <h2 className="panel-title" id="school-timezone-title">School timezone</h2>
          <p className="panel-subtitle">Session dates, history, reports, and notifications use this timezone.</p>
        </div>
        <label className="form-field" htmlFor="schoolTimezone">
          <span className="form-label">IANA timezone</span>
          <input className="form-input" id="schoolTimezone" name="schoolTimezone" defaultValue={settings.school_timezone} maxLength={80} required />
        </label>
      </section>
      <section className="application-settings-group" aria-labelledby="attendance-notification-controls-title">
        <div>
          <h2 className="panel-title" id="attendance-notification-controls-title">Attendance notifications</h2>
          <p className="panel-subtitle">These controls govern event creation; each student&apos;s notification preferences still apply.</p>
        </div>
        <div className="admin-notification-controls">
          {notificationControls.map(([name, label]) => (
            <label className="notification-preference-row" key={name}>
              <span>{label}</span>
              <input type="checkbox" name={name} defaultChecked={settings[name]} />
            </label>
          ))}
        </div>
        <label className="form-field reminder-minutes-field" htmlFor="reminderMinutes">
          <span className="form-label">Reminder before closing (minutes)</span>
          <input className="form-input" id="reminderMinutes" name="reminderMinutes" type="number" min="6" max="60" step="1" defaultValue={settings.reminder_minutes_before_close} required />
        </label>
      </section>
      <FormFeedback state={state} />
      <button className="auth-submit application-settings-save" type="submit" disabled={isPending}>
        {isPending ? "Saving settings..." : "Save settings"}
      </button>
    </form>
  );
}