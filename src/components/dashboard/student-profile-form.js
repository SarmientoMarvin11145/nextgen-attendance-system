"use client";

import { useActionState } from "react";
import { saveStudentProfile } from "@/app/actions/auth";
import FormFeedback from "@/components/auth/form-feedback";
import FormField from "@/components/auth/form-field";

const initialState = { status: "idle", message: "", fieldErrors: {}, values: {} };

export default function StudentProfileForm({ profile }) {
  const [state, action, isPending] = useActionState(saveStudentProfile, initialState);
  const fieldErrors = state.fieldErrors ?? {};
  const values = state.values ?? {};

  return (
    <form className="student-profile-form" action={action} key={JSON.stringify([state.status, values])}>
      <FormField
        id="profileEmail"
        label="Email"
        type="email"
        value={profile.email ?? ""}
        readOnly
      />
      <div className="form-grid">
        <FormField
          id="profileFirstName"
          name="firstName"
          label="First name"
          autoComplete="given-name"
          maxLength={80}
          defaultValue={values.firstName ?? profile.first_name ?? ""}
          required
          error={fieldErrors.firstName}
        />
        <FormField
          id="profileLastName"
          name="lastName"
          label="Last name"
          autoComplete="family-name"
          maxLength={80}
          defaultValue={values.lastName ?? profile.last_name ?? ""}
          required
          error={fieldErrors.lastName}
        />
      </div>
      <FormField
        id="profileCourse"
        name="course"
        label="Course"
        maxLength={120}
        defaultValue={values.course ?? profile.course ?? ""}
        required
        error={fieldErrors.course}
      />
      <div className="form-grid form-grid-academic">
        <FormField
          id="profileYear"
          name="year"
          label="Year"
          maxLength={40}
          defaultValue={values.year ?? profile.year ?? ""}
          required
          error={fieldErrors.year}
        />
        <FormField
          id="profileBlock"
          name="block"
          label="Block"
          maxLength={60}
          defaultValue={values.block ?? profile.block ?? ""}
          required
          error={fieldErrors.block}
        />
        <FormField
          id="profileTeam"
          name="team"
          label="Team"
          maxLength={60}
          defaultValue={values.team ?? profile.team ?? ""}
          required
          error={fieldErrors.team}
        />
      </div>
      <p className="profile-email-note">Email is managed through Supabase Auth and cannot be changed here.</p>
      <FormFeedback state={state} />
      <button className="auth-submit" type="submit" disabled={isPending}>
        {isPending ? "Saving profile..." : "Save Changes"}
      </button>
    </form>
  );
}