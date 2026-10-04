import StudentDashboard from "@/components/dashboard/student-dashboard";
import AttendanceRealtime from "@/components/realtime/attendance-realtime";
import { requireProfileRole } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const profile = await requireProfileRole(["student"]);
  const supabase = await createSupabaseServerClient();

  let profileResult = { data: null, error: null };
  let recordsResult = { data: [], error: null };
  let sessionsResult = { data: [], error: null };
  let timeZoneResult = { data: "Asia/Manila", error: null };

  try {
    [profileResult, recordsResult, sessionsResult, timeZoneResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("first_name, last_name, course, year, block, team")
        .eq("id", profile.id)
        .maybeSingle(),
      supabase
        .from("attendance_records")
        .select("id, session_id, registered_at, attendance_status, location_verified, verification_method")
        .eq("student_id", profile.id)
        .order("registered_at", { ascending: false })
        .limit(50),
      supabase
        .from("attendance_sessions")
        .select("id, title, start_time, end_time, location_requirement, all_gates")
        .eq("status", "open")
        .gt("end_time", new Date().toISOString())
        .order("start_time", { ascending: true }),
      supabase.rpc("get_school_timezone"),
    ]);
  } catch {
    profileResult = { data: null, error: null };
    recordsResult = { data: [], error: null };
    sessionsResult = { data: [], error: null };
    timeZoneResult = { data: "Asia/Manila", error: null };
  }

  const timeZone = typeof timeZoneResult.data === "string" ? timeZoneResult.data : "Asia/Manila";
  let gateCountsBySession = {};

  try {
    const { data: gateCounts } = sessionsResult.data?.length
      ? await supabase.rpc("get_session_gate_counts", { p_session_ids: sessionsResult.data.map((session) => session.id) })
      : { data: [] };
    gateCountsBySession = Object.fromEntries((gateCounts ?? []).map((entry) => [entry.session_id, entry.gate_count]));
  } catch {
    gateCountsBySession = {};
  }

  const records = recordsResult.data ?? [];
  const sessionIds = [...new Set(records.map((record) => record.session_id))];
  let historySessions = [];

  if (sessionIds.length > 0) {
    const { data } = await supabase
      .from("attendance_sessions")
      .select("id, title, start_time")
      .in("id", sessionIds);
    historySessions = data ?? [];
  }

  const sessionsById = Object.fromEntries(historySessions.map((session) => [session.id, session]));
  const displayName = [profileResult.data?.first_name, profileResult.data?.last_name]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <AttendanceRealtime role="student" userId={profile.id} />
      <StudentDashboard
        profile={{
          ...profileResult.data,
          email: profile.email,
          displayName: displayName || "Student",
        }}
        sessions={(sessionsResult.data ?? []).map((session) => ({
          ...session,
          available_gate_count: gateCountsBySession[session.id] ?? 0,
        }))}
        sessionsUnavailable={Boolean(sessionsResult.error)}
        history={records.map((record) => ({
          ...record,
          sessionTitle: sessionsById[record.session_id]?.title ?? "Attendance session",
          sessionStart: sessionsById[record.session_id]?.start_time ?? record.registered_at,
        }))}
        historyUnavailable={Boolean(recordsResult.error)}
        timeZone={timeZone}
        formatDate={(value) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone }).format(new Date(value))}
        formatTime={(value) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(new Date(value))}
      />
    </>
  );
}