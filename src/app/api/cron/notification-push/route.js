import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidCronSecret(request) {
  const expectedSecret = process.env.PUSH_CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  const suppliedSecret = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expectedSecret || !suppliedSecret) return false;

  const expected = Buffer.from(expectedSecret);
  const supplied = Buffer.from(suppliedSecret);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function POST(request) {
  if (!hasValidCronSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!supabaseUrl || !serviceRoleKey || !publicKey || !privateKey || !subject) {
    return Response.json({ error: "Push delivery is not configured." }, { status: 503 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: deliveries, error: claimError } = await supabase.rpc("claim_notification_push_batch", {
    p_limit: 25,
  });

  if (claimError) {
    return Response.json({ error: "Push queue is temporarily unavailable." }, { status: 500 });
  }

  const notifications = new Map();
  for (const delivery of deliveries ?? []) {
    const group = notifications.get(delivery.notification_id) ?? [];
    group.push(delivery);
    notifications.set(delivery.notification_id, group);
  }

  let sent = 0;
  let failed = 0;
  let expired = 0;

  for (const [notificationId, targets] of notifications) {
    let delivered = 0;
    const errors = [];
    const { data: notificationOwner } = await supabase
      .from("notifications")
      .select("user_id")
      .eq("id", notificationId)
      .maybeSingle();

    for (const target of targets) {
      let deliverySucceeded = false;
      let failureCode = null;
      try {
        await webpush.sendNotification({
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        }, JSON.stringify({
          title: target.title,
          body: target.message,
          url: target.attendance_session_id
            ? target.recipient_role === "student"
              ? `/attendance/session/${target.attendance_session_id}`
              : "/admin#attendance-sessions"
            : "/notifications",
          tag: notificationId,
        }), { TTL: 120, urgency: "normal" });

        await supabase
          .from("push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", target.subscription_id);
        delivered += 1;
        deliverySucceeded = true;
      } catch (error) {
        failureCode = Number.isInteger(error.statusCode) ? error.statusCode : null;
        if (error.statusCode === 404 || error.statusCode === 410) {
          await supabase
            .from("push_subscriptions")
            .update({ is_active: false })
            .eq("id", target.subscription_id);
          expired += 1;
        } else {
          errors.push(error.message || "Push delivery failed.");
        }
      }

      await supabase.rpc("log_notification_delivery", {
        p_user_id: notificationOwner?.user_id ?? null,
        p_subscription_id: target.subscription_id,
        p_notification_id: notificationId,
        p_succeeded: deliverySucceeded,
        p_is_test: false,
        p_failure_code: failureCode,
      });
    }

    if (delivered > 0) {
      const { error } = await supabase
        .from("notifications")
        .update({ push_sent_at: new Date().toISOString(), push_claimed_at: null, push_last_error: null })
        .eq("id", notificationId);
      if (error) failed += 1;
      else sent += delivered;
    } else {
      failed += targets.length;
      await supabase
        .from("notifications")
        .update({ push_claimed_at: null, push_last_error: errors.join("; ").slice(0, 300) || "All push subscriptions expired." })
        .eq("id", notificationId);
    }
  }

  return Response.json({ processed: notifications.size, sent, failed, expired });
}