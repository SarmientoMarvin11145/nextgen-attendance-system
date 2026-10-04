"use client";

import { useActionState } from "react";
import { registerStudent } from "@/app/actions/auth";
import FormFeedback from "@/components/auth/form-feedback";
import FormField from "@/components/auth/form-field";
import { registrationBlocks, registrationCourses, registrationTeams, registrationYears } from "@/lib/auth/registration-options";

const initialState = { status: "idle", message: "", fieldErrors: {}, values: {} };

export default function RegistrationForm() {
  const [state, action, isPending] = useActionState(registerStudent, initialState);
  const fieldErrors = state.fieldErrors ?? {};
  const values = state.values ?? {};

  return (
    <form className="auth-form" action={action}>
      <div className="form-grid">
        <FormField
          id="firstName"
          name="firstName"
          label="First name"
          autoComplete="given-name"
          maxLength={80}
          required
          defaultValue={values.firstName ?? ""}
          error={fieldErrors.firstName}
        />
        <FormField
          id="lastName"
          name="lastName"
          label="Last name"
          autoComplete="family-name"
          maxLength={80}
          required
          defaultValue={values.lastName ?? ""}
          error={fieldErrors.lastName}
        />
      </div>
      <FormField
        id="registerEmail"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        maxLength={254}
        required
        defaultValue={values.email ?? ""}
        error={fieldErrors.email}
      />
      <FormField
        id="course"
        name="course"
        label="Course"
        options={registrationCourses}
        required
        defaultValue={values.course ?? ""}
        error={fieldErrors.course}
      />
      <div className="form-grid form-grid-academic">
        <FormField
          id="year"
          name="year"
          label="Year"
          options={registrationYears}
          required
          defaultValue={values.year ?? ""}
          error={fieldErrors.year}
        />
        <FormField
          id="block"
          name="block"
          label="Block"
          options={registrationBlocks}
          required
          defaultValue={values.block ?? ""}
          error={fieldErrors.block}
        />
        <FormField
          id="team"
          name="team"
          label="Team"
          options={registrationTeams}
          required
          defaultValue={values.team ?? ""}
          error={fieldErrors.team}
        />
      </div>
      <div className="form-grid">
        <FormField
          id="registerPassword"
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          maxLength={128}
          minLength={10}
          required
          error={fieldErrors.password}
        />
        <FormField
          id="confirmPassword"
          name="confirmPassword"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          maxLength={128}
          minLength={10}
          required
          error={fieldErrors.confirmPassword}
        />
      </div>
      <p className="password-hint">Use 10 or more characters with upper and lowercase letters, a number, and a symbol.</p>
      <FormFeedback state={state} />
      <button className="auth-submit" type="submit" disabled={isPending}>
        {isPending ? "Creating account..." : "Create student account"}
      </button>
    </form>
  );
}