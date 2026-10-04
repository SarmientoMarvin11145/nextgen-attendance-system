"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { removePushSubscription, saveNotificationPreferences, savePushSubscription } from "@/app/actions/push-notifications";
import FormFeedback from "@/components/auth/form-feedback";
import PendingActionButton from "@/components/pending-action-button";
import TestNotificationButton from "@/components/notifications/test-notification-button";

const initialPreferenceState = { status: "idle", message: "" };

const preferenceOptions = [
  ["attendance_open", "Attendance started"],
  ["attendance_reminder", "Attendance reminder"],
  ["attendance_closing", "Attendance ending"],
  ["attendance_recorded", "Attendance recorded"],
  ["system_notifications", "System notifications"],
];

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const rawData = window.atob((base64String + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
}

function deviceName() {
  return navigator.userAgentData?.platform || navigator.platform || "Browser device";
}

function PushSubscriptionSettings({ initialDevices, pushConfigured }) {
  const [devices, setDevices] = useState(initialDevices);
  const [permission, setPermission] = useState("unknown");
  const supported = permission !== "unknown" && permission !== "unsupported";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState(false);
  const dialogRef = useRef(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const isSupported = "Notification" in window
        && "serviceWorker" in navigator
        && "PushManager" in window;
      setPermission(isSupported ? Notification.permission : "unsupported");
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogOpen && !dialog.open) dialog.showModal();
    if (!dialogOpen && dialog.open) dialog.close();
  }, [dialogOpen]);

  async function enablePush() {
    if (isPending) return;
    setIsPending(true);
    setFeedback("");

    try {
      let currentPermission = Notification.permission;
      if (currentPermission === "default") {
        currentPermission = await Notification.requestPermission();
      }
      setPermission(currentPermission);

      if (currentPermission !== "granted") {
        setFeedback(currentPermission === "denied"
          ? "Notifications are blocked in browser settings. Change the site permission there, then try again."
          : "Notification permission was not changed.");
        setFeedbackError(currentPermission === "denied");
        setDialogOpen(false);
        return;
      }

      if (!pushConfigured || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
        setFeedback("Push notifications are not configured on this server yet.");
        setFeedbackError(true);
        setDialogOpen(false);
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const subscription = await registration.pushManager.getSubscription()
        ?? await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
        });
      const result = await savePushSubscription({
        ...subscription.toJSON(),
        deviceName: deviceName(),
        userAgent: navigator.userAgent,
      });

      if (result.status !== "success") {
        setFeedback(result.message || "This device could not be added.");
        setFeedbackError(true);
        return;
      }

      setDevices((current) => [result.device, ...current.filter((device) => device.id !== result.device.id)]);
      setFeedback("This device is enabled for browser notifications.");
      setFeedbackError(false);
      setDialogOpen(false);
    } catch {
      setFeedback("Push notifications could not be enabled. Check this browser and try again.");
      setFeedbackError(true);
    } finally {
      setIsPending(false);
    }
  }

  function openExplanation() {
    setFeedback("");
    setDialogOpen(true);
  }

  return (
    <section className="panel push-settings-panel" aria-labelledby="push-devices-title">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title" id="push-devices-title">Browser notifications</h2>
          <p className="panel-subtitle">
            {permission === "denied"
              ? "Notifications are blocked in this browser. Change the site permission in browser settings."
              : permission === "unsupported"
                ? "This browser does not support Web Push notifications."
                : `${devices.length} device${devices.length === 1 ? "" : "s"} registered`}
          </p>
        </div>
        {supported && permission !== "denied" && (
          <button className="auth-submit push-enable-button" type="button" onClick={openExplanation} disabled={isPending || !pushConfigured}>
            {isPending ? "Enabling..." : "Enable on this device"}
          </button>
        )}
      </div>
      {!pushConfigured && <p className="form-feedback form-feedback-error" role="status">Push delivery is not configured on this server.</p>}
      {feedback && <p className={`form-feedback ${feedbackError ? "form-feedback-error" : "form-feedback-success"}`} role={feedbackError ? "alert" : "status"}>{feedback}</p>}
      {devices.length > 0 && (
        <div className="push-device-list" aria-label="Registered devices">
          {devices.map((device) => (
            <article className="push-device-row" key={device.id}>
              <div>
                <h3 className="notification-title">{device.device_name}</h3>
                <p className="panel-subtitle">Added {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(device.created_at))}</p>
              </div>
              <form action={removePushSubscription}>
                <input type="hidden" name="subscriptionId" value={device.id} />
                <PendingActionButton className="notification-mark-read" pendingLabel="Removing...">Remove device</PendingActionButton>
              </form>
            </article>
          ))}
        </div>
      )}
      {permission === "granted" && <TestNotificationButton />}
      <dialog className="location-consent-dialog notification-consent-dialog" ref={dialogRef} onCancel={() => setDialogOpen(false)}>
        <div className="location-dialog-content">
          <p className="eyebrow">Browser notifications</p>
          <h2 className="location-dialog-title">Enable Notifications?</h2>
          <p className="location-dialog-copy">Get important attendance reminders even when you are not currently viewing the attendance page.</p>
          <div className="location-dialog-actions">
            <button className="location-cancel" type="button" onClick={() => setDialogOpen(false)} disabled={isPending}>Not Now</button>
            <button className="auth-submit location-allow" type="button" onClick={enablePush} disabled={isPending}>
              {isPending ? "Enabling..." : "Enable Notifications"}
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}

function NotificationPreferenceForm({ preferences }) {
  const [state, action, isPending] = useActionState(saveNotificationPreferences, initialPreferenceState);

  return (
    <form className="notification-preferences-form" action={action}>
      <fieldset className="notification-preference-list">
        <legend className="sr-only">Notification preferences</legend>
        {preferenceOptions.map(([name, label]) => (
          <label className="notification-preference-row" key={name}>
            <span>{label}</span>
            <input type="checkbox" name={name} defaultChecked={preferences[name]} />
          </label>
        ))}
      </fieldset>
      <FormFeedback state={state} />
      <button className="auth-submit notification-preferences-save" type="submit" disabled={isPending}>
        {isPending ? "Saving preferences..." : "Save preferences"}
      </button>
    </form>
  );
}

export default function NotificationSettings({ preferences, devices, pushConfigured }) {
  return (
    <div className="notification-settings-content">
      <PushSubscriptionSettings initialDevices={devices} pushConfigured={pushConfigured} />
      <section className="panel notification-preferences-panel" aria-labelledby="notification-preferences-title">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title" id="notification-preferences-title">Notification preferences</h2>
            <p className="panel-subtitle">Choose which browser push notifications you receive.</p>
          </div>
        </div>
        <NotificationPreferenceForm preferences={preferences} />
      </section>
    </div>
  );
}