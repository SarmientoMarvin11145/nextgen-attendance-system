"use client";

import { useActionState } from "react";
import { updatePassword } from "@/app/actions/auth";
import FormFeedback from "@/components/auth/form-feedback";
import FormField from "@/components/auth/form-field";

const initialState = { status: "idle", message: "", fieldErrors: {}, values: {} };

export default function UpdatePasswordForm() {
  const [state, action, isPending] = useActionState(updatePassword, initialState);

  return (
    <form className="auth-form" action={action}>
      <FormField
        id="newPassword"
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        maxLength={128}
        required
        error={state.fieldErrors?.password}
      />
      <FormField
        id="confirmNewPassword"
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        maxLength={128}
        required
        error={state.fieldErrors?.confirmPassword}
      />
      <p className="password-hint">Use 10 or more characters with upper and lowercase letters, a number, and a symbol.</p>
      <FormFeedback state={state} />
      <button className="auth-submit" type="submit" disabled={isPending}>
        {isPending ? "Updating password..." : "Update password"}
      </button>
    </form>
  );
}