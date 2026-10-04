"use client";

import { useActionState } from "react";
import { sendTestPushNotification } from "@/app/actions/push-notifications";
import FormFeedback from "@/components/auth/form-feedback";

const initialState = { status: "idle", message: "" };

export default function TestNotificationButton() {
  const [state, action, isPending] = useActionState(sendTestPushNotification, initialState);

  return (
    <form className="test-notification-form" action={action}>
      <button className="report-action-link" type="submit" disabled={isPending}>
        {isPending ? "Sending test..." : "Send Test Notification"}
      </button>
      <FormFeedback state={state} />
    </form>
  );
}