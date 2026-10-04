import { markAllNotificationsRead, markNotificationRead } from "@/app/actions/notifications";
import PendingActionButton from "@/components/pending-action-button";
import Link from "next/link";
import { requireAuthenticatedProfile } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function NotificationsPage() {
  const profile = await requireAuthenticatedProfile();
  const supabase = await createSupabaseServerClient();
  const [{ data: notifications, error }, timeZoneResult] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, title, message, type, is_read, created_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.rpc("get_school_timezone"),
  ]);
  const timeZone = typeof timeZoneResult.data === "string" ? timeZoneResult.data : "Asia/Manila";
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  const unreadCount = (notifications ?? []).filter((notification) => !notification.is_read).length;

  return (
    <div className="page-content notifications-page">
      <section className="page-heading" aria-labelledby="notifications-page-title">
        <div>
          <p className="eyebrow">Your inbox</p>
          <h1 className="page-title" id="notifications-page-title">Notifications</h1>
          <p className="page-description">{unreadCount} unread</p>
        </div>
        <div className="notification-heading-actions">
          <Link className="text-link" href="/notifications/settings">Settings</Link>
          {unreadCount > 0 && (
            <form action={markAllNotificationsRead}>
              <PendingActionButton className="topbar-primary notification-mark-all" pendingLabel="Marking all read...">Mark all read</PendingActionButton>
            </form>
          )}
        </div>
      </section>

      {error ? (
        <section className="panel"><p className="empty-state">Notifications are temporarily unavailable.</p></section>
      ) : notifications?.length ? (
        <section className="notification-list" aria-label="Your notifications">
          {notifications.map((notification) => (
            <article className={`notification-row${notification.is_read ? "" : " notification-unread"}`} key={notification.id}>
              <div className="notification-content">
                <div className="notification-title-line">
                  <h2 className="notification-title">{notification.title}</h2>
                  {!notification.is_read && <span className="notification-new">New</span>}
                </div>
                <p className="notification-message">{notification.message}</p>
                <time className="notification-time" dateTime={notification.created_at}>
                  {dateFormatter.format(new Date(notification.created_at))}
                </time>
              </div>
              {!notification.is_read && (
                <form action={markNotificationRead}>
                  <input type="hidden" name="notificationId" value={notification.id} />
                  <PendingActionButton className="notification-mark-read" pendingLabel="Marking read...">Mark read</PendingActionButton>
                </form>
              )}
            </article>
          ))}
        </section>
      ) : (
        <section className="panel"><p className="empty-state">You&apos;re all caught up.</p></section>
      )}
    </div>
  );
}