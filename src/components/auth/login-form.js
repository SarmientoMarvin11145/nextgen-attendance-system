"use client";

import { useActionState } from "react";
import { signIn } from "@/app/actions/auth";
import FormFeedback from "@/components/auth/form-feedback";
import FormField from "@/components/auth/form-field";

const initialState = { status: "idle", message: "", fieldErrors: {}, values: {} };

export default function LoginForm({ next = "" }) {
  const [state, action, isPending] = useActionState(signIn, initialState);
  const fieldErrors = state.fieldErrors ?? {};
  const values = state.values ?? {};

  return (
    <form className="auth-form" action={action}>
      <FormField
        id="loginEmail"
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
        id="loginPassword"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        error={fieldErrors.password}
      />
      <FormFeedback state={state} />
      <button className="auth-submit" type="submit" disabled={isPending}>
        {isPending ? "Signing in..." : "Sign in"}
      </button>
      {next && <input type="hidden" name="next" value={next} />}
    </form>
  );
}