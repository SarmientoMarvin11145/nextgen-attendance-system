import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { renderNotificationEmail, sendTransactionalEmail } from "@/lib/email/resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidCronSecret(request) {
  const expectedSecret = process.env.EMAIL_CRON_SECRET;
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
  if (!supabaseUrl || !serviceRoleKey || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return Response.json({ error: "Email delivery is not configured." }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: deliveries, error } = await supabase.rpc("claim_notification_email_batch", {
    p_limit: 25,
  });

  if (error) {
    return Response.json({ error: "Email queue is temporarily unavailable." }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;

  for (const delivery of deliveries ?? []) {
    const email = renderNotificationEmail(delivery.title, delivery.message);
    const result = await sendTransactionalEmail({
      to: delivery.recipient_email,
      ...email,
      idempotencyKey: delivery.notification_id,
    });

    if (result.sent) {
      const { error: updateError } = await supabase
        .from("notifications")
        .update({ email_sent_at: new Date().toISOString(), email_claimed_at: null, email_last_error: null })
        .eq("id", delivery.notification_id)
        .is("email_sent_at", null);
      if (updateError) failed += 1;
      else sent += 1;
    } else {
      await supabase
        .from("notifications")
        .update({ email_last_error: result.error?.slice(0, 300) ?? "Email delivery failed." })
        .eq("id", delivery.notification_id)
        .is("email_sent_at", null);
      failed += 1;
    }
  }

  return Response.json({ processed: deliveries?.length ?? 0, sent, failed });
}

export const GET = POST;