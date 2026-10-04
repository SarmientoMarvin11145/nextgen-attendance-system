"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { requireAuthenticatedProfile } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const subscriptionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const subscriptionKeyPattern = /^[A-Za-z0-9_-]+$/;
const preferenceFields = [
  "attendance_open",
  "attendance_reminder",
  "attendance_closing",
  "attendance_recorded",
  "system_notifications",
];

export async function saveNotificationPreferences(_previousState, formData) {
  const profile = await requireAuthenticatedProfile();
  const preferences = Object.fromEntries(preferenceFields.map((field) => [field, formData.get(field) === "on"]));

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: profile.id, ...preferences }, { onConflict: "user_id" });

    if (error) return { status: "error", message: "Notification preferences could not be saved." };
  } catch {
    return { status: "error", message: "We could not reach notification settings. Try again." };
  }

  revalidatePath("/notifications/settings");
  return { status: "success", message: "Notification preferences saved." };
}

export async function savePushSubscription(value) {
  const profile = await requireAuthenticatedProfile();
  const endpoint = typeof value?.endpoint === "string" ? value.endpoint : "";
  const p256dh = typeof value?.keys?.p256dh === "string" ? value.keys.p256dh : "";
  const auth = typeof value?.keys?.auth === "string" ? value.keys.auth : "";
  const deviceName = typeof value?.deviceName === "string" ? value.deviceName.trim().slice(0, 120) : "Browser device";
  const userAgent = typeof value?.userAgent === "string" ? value.userAgent.slice(0, 1024) : "";

  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    return { status: "error", message: "The browser returned an invalid push subscription." };
  }

  if (endpointUrl.protocol !== "https:"
    || endpoint.length > 2048
    || !subscriptionKeyPattern.test(p256dh)
    || !subscriptionKeyPattern.test(auth)
    || !deviceName) {
    return { status: "error", message: "The browser returned an invalid push subscription." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: existing, error: lookupError } = await supabase
      .from("push_subscriptions")
      .select("id")
      .eq("user_id", profile.id)
      .eq("endpoint", endpoint)
      .maybeSingle();

    if (lookupError) return { status: "error", message: "Push settings are temporarily unavailable." };

    const subscription = {
      endpoint,
      p256dh,
      auth,
      device_name: deviceName,
      user_agent: userAgent,
      is_active: true,
      last_used_at: new Date().toISOString(),
    };
    const result = existing
      ? await supabase.from("push_subscriptions").update(subscription).eq("id", existing.id).eq("user_id", profile.id).select("id, device_name, created_at").maybeSingle()
      : await supabase.from("push_subscriptions").insert({ user_id: profile.id, ...subscription }).select("id, device_name, created_at").maybeSingle();

    if (result.error || !result.data) {
      return { status: "error", message: "This device could not be added to push notifications." };
    }

    revalidatePath("/notifications/settings");
    return { status: "success", device: result.data };
  } catch {
    return { status: "error", message: "We could not save this device. Try again." };
  }
}

export async function removePushSubscription(formData) {
  const profile = await requireAuthenticatedProfile();
  const id = formData.get("subscriptionId");
  if (typeof id !== "string" || !subscriptionIdPattern.test(id)) return;

  const supabase = await createSupabaseServerClient();
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("id", id)
    .eq("user_id", profile.id);

  revalidatePath("/notifications/settings");
}

export async function sendTestPushNotification(_previousState, _formData) {
  const profile = await requireAuthenticatedProfile();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!supabaseUrl || !serviceRoleKey || !publicKey || !privateKey || !subject) {
    return { status: "error", message: "Push delivery is not configured on this server." };
  }

  try {
    const userSupabase = await createSupabaseServerClient();
    const { data: ownedSubscriptions, error: subscriptionError } = await userSupabase
      .from("push_subscriptions")
      .select("id")
      .eq("user_id", profile.id)
      .eq("is_active", true);

    if (subscriptionError) return { status: "error", message: "Push subscriptions are temporarily unavailable." };
    if (!ownedSubscriptions?.length) return { status: "error", message: "Enable notifications on at least one device first." };

    const serviceSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: subscriptions, error } = await serviceSupabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("id", ownedSubscriptions.map((subscription) => subscription.id))
      .eq("user_id", profile.id)
      .eq("is_active", true);

    if (error) return { status: "error", message: "Push subscriptions are temporarily unavailable." };

    webpush.setVapidDetails(subject, publicKey, privateKey);
    let sent = 0;
    let failed = 0;
    for (const subscription of subscriptions ?? []) {
      let succeeded = false;
      let failureCode = null;
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, JSON.stringify({
          title: "Attendance System",
          body: "This is a test notification.",
          url: "/notifications/settings",
          tag: "attendance-test",
        }), { TTL: 60, urgency: "normal" });
        succeeded = true;
        sent += 1;
      } catch (pushError) {
        failureCode = Number.isInteger(pushError.statusCode) ? pushError.statusCode : null;
        failed += 1;
        if (failureCode === 404 || failureCode === 410) {
          await serviceSupabase.from("push_subscriptions").update({ is_active: false }).eq("id", subscription.id);
        }
      }

      await serviceSupabase.rpc("log_notification_delivery", {
        p_user_id: profile.id,
        p_subscription_id: subscription.id,
        p_notification_id: null,
        p_succeeded: succeeded,
        p_is_test: true,
        p_failure_code: failureCode,
      });
    }

    revalidatePath("/notifications/settings");
    return sent > 0
      ? { status: "success", message: `Test notification sent to ${sent} device${sent === 1 ? "" : "s"}.${failed ? ` ${failed} device${failed === 1 ? "" : "s"} could not be reached.` : ""}` }
      : { status: "error", message: "The test notification could not be delivered. Check browser permission and try again." };
  } catch {
    return { status: "error", message: "Test notification delivery failed. Check your connection and push settings." };
  }
}