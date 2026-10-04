"use client";

import { useActionState } from "react";
import { createAttendanceSession } from "@/app/actions/attendance";
import FormFeedback from "@/components/auth/form-feedback";
import FormField from "@/components/auth/form-field";

const initialState = { status: "idle", message: "", fieldErrors: {}, values: {} };

export default function CreateAttendanceForm({ timeZone = "Asia/Manila", gates = [] }) {
  const [state, action, isPending] = useActionState(createAttendanceSession, initialState);
  const values = state.values ?? {};
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form
      className="create-attendance-form"
      action={action}
      key={state.status === "success" ? state.message : "attendance-form"}
    >
      <p className="panel-subtitle">Session dates and times use {timeZone}.</p>
      <FormField
        id="attendanceTitle"
        name="title"
        label="Attendance title"
        maxLength={120}
        placeholder="e.g. Morning Attendance"
        defaultValue={values.title ?? ""}
        required
        error={fieldErrors.title}
      />
      <div className="form-field">
        <label className="form-label" htmlFor="attendanceDescription">Description</label>
        <textarea
          className="form-input form-textarea"
          id="attendanceDescription"
          name="description"
          maxLength={1000}
          rows={3}
          defaultValue={values.description ?? ""}
          placeholder="Add details for this attendance session."
        />
        {fieldErrors.description && <p className="field-error">{fieldErrors.description}</p>}
      </div>
      <div className="form-grid session-date-grid">
        <FormField
          id="attendanceDate"
          name="date"
          label="Date"
          type="date"
          defaultValue={values.date ?? ""}
          required
          error={fieldErrors.date}
        />
        <FormField
          id="attendanceEndDate"
          name="endDate"
          label="End date (optional)"
          type="date"
          defaultValue={values.endDate ?? ""}
          error={fieldErrors.endDate}
        />
      </div>
      <div className="form-grid">
        <FormField
          id="attendanceStartTime"
          name="startTime"
          label="Start time"
          type="time"
          defaultValue={values.startTime ?? ""}
          required
          error={fieldErrors.startTime}
        />
        <FormField
          id="attendanceEndTime"
          name="endTime"
          label="End time"
          type="time"
          defaultValue={values.endTime ?? ""}
          required
          error={fieldErrors.endTime}
        />
      </div>
      <label className="form-field" htmlFor="attendanceLocationRequirement">
        <span className="form-label">Location verification</span>
        <select
          className="form-input"
          id="attendanceLocationRequirement"
          name="locationRequirement"
          defaultValue={values.locationRequirement ?? "required"}
        >
          <option value="required">Required</option>
          <option value="optional">Optional</option>
          <option value="disabled">Disabled</option>
        </select>
        <span className="panel-subtitle">Required checks campus location. Optional allows check-in without it. Disabled skips location checks.</span>
      </label>
      <fieldset className="attendance-gate-selection">
        <legend className="form-label">Attendance gates</legend>
        <label className="attendance-gate-option attendance-gate-all">
          <input type="checkbox" name="allGates" defaultChecked />
          <span>All active gates</span>
        </label>
        {gates.length === 0 ? (
          <p className="panel-subtitle">No active gates configured. An administrator must add one before attendance can be created.</p>
        ) : (
          <div className="attendance-gate-options">
            {gates.map((gate) => (
              <label className="attendance-gate-option" key={gate.id}>
                <input type="checkbox" name="gateIds" value={gate.id} />
                <span>{gate.name} <small>{gate.code}</small></span>
              </label>
            ))}
          </div>
        )}
        {fieldErrors.gateIds && <p className="field-error">{fieldErrors.gateIds}</p>}
      </fieldset>
      <div className="session-filters" aria-labelledby="session-filters-title">
        <div>
          <h3 className="session-filters-title" id="session-filters-title">Optional student filters</h3>
          <p className="panel-subtitle">Leave as All to include every student.</p>
        </div>
        <div className="form-grid session-filter-grid">
          <FormField id="attendanceCourse" name="course" label="Course" maxLength={120} defaultValue={values.course ?? "All"} error={fieldErrors.course} />
          <FormField id="attendanceYear" name="year" label="Year" maxLength={40} defaultValue={values.year ?? "All"} error={fieldErrors.year} />
          <FormField id="attendanceBlock" name="block" label="Block" maxLength={60} defaultValue={values.block ?? "All"} error={fieldErrors.block} />
          <FormField id="attendanceTeam" name="team" label="Team" maxLength={60} defaultValue={values.team ?? "All"} error={fieldErrors.team} />
        </div>
      </div>
      <FormFeedback state={state} />
      <button className="auth-submit create-attendance-submit" type="submit" disabled={isPending}>
        {isPending ? "Creating attendance..." : "Create Attendance"}
      </button>
    </form>
  );
}