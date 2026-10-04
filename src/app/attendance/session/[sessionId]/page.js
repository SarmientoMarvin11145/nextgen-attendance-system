import Link from "next/link";
import { notFound } from "next/navigation";
import StudentQrPanel from "@/components/dashboard/student-qr-panel";
import WorkspaceShell from "@/components/workspace-shell";
import { requireProfileRole } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function AttendanceConfirmation({ record, timeZone }) {
  const registeredTime = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(new Date(record.registered_at));

  return (
    <section className="panel attendance-session-confirmation" aria-labelledby="attendance-confirmation-title">
      <p className="eyebrow">Attendance Confirmed</p>
      <h2 className="panel-title" id="attendance-confirmation-title">Your attendance has been recorded.</h2>
      <p className="attendance-confirmation-time">Time: <strong>{registeredTime}</strong></p>
      <p className="attendance-confirmation-time">Status: <strong>{record.attendance_status.toUpperCase()}</strong></p>
      <ul className="verification-badges" aria-label="Verification details">
        <li>QR Verified</li>
        {record.location_verified && <li>Location Verified</li>}
      </ul>
    </section>
  );
}

export default async function AttendanceSessionPage({ params }) {
  const { sessionId } = await params;
  if (!sessionIdPattern.test(sessionId)) notFound();

  const returnPath = `/attendance/session/${sessionId}`;
  const profile = await requireProfileRole(["student"], {
    loginRedirect: `/login?next=${encodeURIComponent(returnPath)}`,
  });
  const supabase = await createSupabaseServerClient();
  const [{ data: session }, { data: record, error: recordError }, { count: unreadCount }, timeZoneResult, schoolClockResult, gateCountResult] = await Promise.all([
    supabase
      .from("attendance_sessions")
      .select("id, title, start_time, end_time, status, location_requirement, all_gates")
      .eq("id", sessionId)
      .maybeSingle(),
    supabase
      .from("attendance_records")
      .select("id, registered_at, attendance_status, location_verified, verification_method")
      .eq("session_id", sessionId)
      .eq("student_id", profile.id)
      .maybeSingle(),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .eq("is_read", false),
    supabase.rpc("get_school_timezone"),
    supabase.rpc("get_school_now"),
    supabase.rpc("get_session_gate_count", { p_session_id: sessionId }),
  ]);

  if (!session) notFound();

  if (schoolClockResult.error || typeof schoolClockResult.data !== "string") {
    throw new Error("School clock settings are unavailable.");
  }

  const now = Date.parse(schoolClockResult.data);
  const timeZone = typeof timeZoneResult.data === "string" ? timeZoneResult.data : "Asia/Manila";
  const isOpen = session.status === "open"
    && now >= Date.parse(session.start_time)
    && now < Date.parse(session.end_time);

  const sessionWithGateCount = {
    ...session,
    available_gate_count: gateCountResult.data ?? 0,
  };

  return (
    <WorkspaceShell role="student" unreadNotificationCount={unreadCount ?? 0}>
      <div className="page-content attendance-session-page">
        <section className="page-heading" aria-labelledby="attendance-session-title">
          <div>
            <p className="eyebrow">Attendance session</p>
            <h1 className="page-title" id="attendance-session-title">{session.title}</h1>
            <p className="page-description">
              {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone }).format(new Date(session.start_time))}
              {" · "}{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(new Date(session.start_time))}
              {" – "}{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(new Date(session.end_time))}
            </p>
          </div>
          <Link className="topbar-primary history-back-link" href="/dashboard">Dashboard</Link>
        </section>
        {recordError ? (
          <section className="panel"><p className="empty-state">Attendance verification requires an active internet connection. Reconnect and try again.</p></section>
        ) : record ? (
          <AttendanceConfirmation record={record} timeZone={timeZone} />
        ) : isOpen ? (
          <section className="panel attendance-session-registration" aria-labelledby="session-registration-title">
            <h2 className="panel-title" id="session-registration-title">Register Attendance</h2>
            <p className="panel-subtitle">Request a temporary QR code for this session.</p>
            <StudentQrPanel sessions={[sessionWithGateCount]} unavailable={false} timeZone={timeZone} />
          </section>
        ) : (
          <section className="panel"><p className="empty-state">This attendance session is not currently accepting registrations.</p></section>
        )}
      </div>
    </WorkspaceShell>
  );
}