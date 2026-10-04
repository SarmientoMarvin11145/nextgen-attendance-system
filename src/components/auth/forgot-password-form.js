"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "@/app/actions/auth";
import FormFeedback from "@/components/auth/form-feedback";
import FormField from "@/components/auth/form-field";

const initialState = { status: "idle", message: "", fieldErrors: {}, values: {} };

export default function ForgotPasswordForm() {
  const [state, action, isPending] = useActionState(requestPasswordReset, initialState);

  return (
    <form className="auth-form" action={action}>
      <FormField
        id="resetEmail"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        maxLength={254}
        required
        defaultValue={state.values?.email ?? ""}
        error={state.fieldErrors?.email}
      />
      <FormFeedback state={state} />
      <button className="auth-submit" type="submit" disabled={isPending}>
        {isPending ? "Sending instructions..." : "Send reset instructions"}
      </button>
    </form>
  );
}