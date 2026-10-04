import AttendanceQrScanner from "@/components/admin/attendance-qr-scanner";
import AttendanceSessionList from "@/components/admin/attendance-session-list";
import CreateAttendanceForm from "@/components/admin/create-attendance-form";
import OfficerDashboard from "@/components/admin/officer-dashboard";
import AttendanceRealtime from "@/components/realtime/attendance-realtime";
import { requireProfileRole } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addCalendarDays, dateInTimeZone, zonedDateTimeToIso } from "@/lib/time-zone";

function getSessionState(session, attendanceCount, now) {
  if (session.status === "completed") return "Completed";
  if (session.status === "cancelled") return "Expired";
  if (now < Date.parse(session.start_time)) return "Upcoming";
  if (now < Date.parse(session.end_time)) return "Active";
  return attendanceCount > 0 ? "Completed" : "Expired";
}

async function fetchAllRows(createQuery) {
  const rows = [];

  for (let offset = 0; offset < 50_000; offset += 1_000) {
    const { data, error } = await createQuery().range(offset, offset + 999);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < 1_000) break;
  }

  return { data: rows, error: null };
}

export default async function AdminPage() {
  const profile = await requireProfileRole(["officer", "admin"]);
  const supabase = await createSupabaseServerClient();

  let configuredTimeZone = "Asia/Manila";
  let schoolNow = new Date().toISOString();
  let schoolClockError = null;
  let activeGates = [];

  try {
    const results = await Promise.all([
      supabase.rpc("get_school_timezone"),
      supabase.rpc("get_school_now"),
      supabase.rpc("list_active_attendance_gates"),
    ]);
    configuredTimeZone = typeof results[0]?.data === "string" ? results[0].data : "Asia/Manila";
    schoolNow = typeof results[1]?.data === "string" ? results[1].data : new Date().toISOString();
    schoolClockError = results[1]?.error ?? null;
    activeGates = results[2]?.data ?? [];
  } catch {
    configuredTimeZone = "Asia/Manila";
    schoolNow = new Date().toISOString();
    schoolClockError = null;
    activeGates = [];
  }

  if (schoolClockError || typeof schoolNow !== "string" || !Number.isFinite(Date.parse(schoolNow))) {
    schoolNow = new Date().toISOString();
  }
  const timeZone = typeof configuredTimeZone === "string" ? configuredTimeZone : "Asia/Manila";
  let sessionsQuery = supabase
    .from("attendance_sessions")
    .select("id, title, description, start_time, end_time, status, course_filter, year_filter, block_filter, team_filter")
    .order("start_time", { ascending: false })
    .limit(40);

  if (profile.role === "officer") {
    sessionsQuery = sessionsQuery.eq("created_by", profile.id);
  }

  const { data: sessions, error: sessionsError } = await sessionsQuery;
  const sessionIds = (sessions ?? []).map((session) => session.id);
  const [studentsResult, recordsResult, profileResult, notificationsResult] = await Promise.all([
    fetchAllRows(() => supabase
      .from("profiles")
      .select("course, year, block, team")
      .eq("role", "student")),
    sessionIds.length > 0
      ? fetchAllRows(() => supabase
        .from("attendance_records")
        .select("session_id, attendance_status, registered_at, gate_id")
        .in("session_id", sessionIds))
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", profile.id)
      .maybeSingle(),
    supabase
      .from("notifications")
      .select("id, title, message, type, is_read, created_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const studentProfiles = studentsResult.data;
  const records = recordsResult.data;
  const [{ data: sessionGateOptions }, { data: sessionGateStatuses }] = sessionIds.length > 0
    ? await Promise.all([
      supabase.rpc("get_staff_session_gate_options", { p_session_ids: sessionIds }),
      supabase.rpc("get_staff_session_gate_statuses", { p_session_ids: sessionIds }),
    ])
    : [{ data: [] }, { data: [] }];
  const gateOptionsBySession = (sessionGateOptions ?? []).reduce((options, gate) => {
    options[gate.session_id] ??= [];
    options[gate.session_id].push(gate);
    return options;
  }, {});
  const gateStatusesBySession = (sessionGateStatuses ?? []).reduce((statuses, gate) => {
    statuses[gate.session_id] ??= [];
    statuses[gate.session_id].push(gate);
    return statuses;
  }, {});
  const attendanceCounts = {};
  const attendanceBySession = {};

  for (const record of records) {
    attendanceCounts[record.session_id] = (attendanceCounts[record.session_id] ?? 0) + 1;
    const sessionCounts = attendanceBySession[record.session_id] ?? { present: 0, late: 0, absent: 0 };
    sessionCounts[record.attendance_status] = (sessionCounts[record.attendance_status] ?? 0) + 1;
    attendanceBySession[record.session_id] = sessionCounts;
  }

  const expectedBySession = {};
  const sessionsForMetrics = sessions ?? [];

  for (const session of sessionsForMetrics) {
    expectedBySession[session.id] = studentProfiles.filter((student) => {
      const filters = [
        [session.course_filter, student.course],
        [session.year_filter, student.year],
        [session.block_filter, student.block],
        [session.team_filter, student.team],
      ];
      return filters.every(([filter, value]) => !filter || (value ?? "").trim().toLowerCase() === filter.trim().toLowerCase());
    }).length;
  }

  const now = Date.parse(schoolNow);
  const localToday = dateInTimeZone(new Date(now), timeZone);
  const dayStart = Date.parse(zonedDateTimeToIso(localToday, "00:00", timeZone));
  const dayEnd = Date.parse(zonedDateTimeToIso(addCalendarDays(localToday, 1), "00:00", timeZone));
  const todaySessions = sessionsForMetrics.filter((session) => (
    Date.parse(session.start_time) < dayEnd
    && Date.parse(session.end_time) > dayStart
    && session.status !== "cancelled"
  ));
  const activeSessions = todaySessions.filter((session) => (
    session.status === "open"
    && now >= Date.parse(session.start_time)
    && now < Date.parse(session.end_time)
  ));
  const todaySessionIds = new Set(todaySessions.map((session) => session.id));
  const todayGateCounts = {};
  for (const record of records) {
    const registeredAt = Date.parse(record.registered_at);
    if (record.gate_id && todaySessionIds.has(record.session_id) && registeredAt >= dayStart && registeredAt < dayEnd) {
      todayGateCounts[record.gate_id] = (todayGateCounts[record.gate_id] ?? 0) + 1;
    }
  }
  const presentToday = todaySessions.reduce((total, session) => {
    const counts = attendanceBySession[session.id] ?? {};
    return total + (counts.present ?? 0) + (counts.late ?? 0);
  }, 0);
  const expectedToday = todaySessions.reduce((total, session) => total + (expectedBySession[session.id] ?? 0), 0);
  const reportSessions = sessionsForMetrics.slice(0, 12).map((session) => ({
    ...session,
    attendanceCount: attendanceCounts[session.id] ?? 0,
    expectedCount: expectedBySession[session.id] ?? 0,
    presentCount: (attendanceBySession[session.id]?.present ?? 0) + (attendanceBySession[session.id]?.late ?? 0),
    lateCount: attendanceBySession[session.id]?.late ?? 0,
    absentCount: attendanceBySession[session.id]?.absent ?? 0,
    state: getSessionState(session, attendanceCounts[session.id] ?? 0, now),
  }));

  return (
    <OfficerDashboard
      realtime={<AttendanceRealtime role={profile.role} userId={profile.id} />}
      profile={{
        displayName: [profileResult.data?.first_name, profileResult.data?.last_name].filter(Boolean).join(" ") || "Officer",
        email: profile.email,
        role: profile.role,
      }}
      stats={{
        activeAttendance: activeSessions.length,
        studentsPresent: presentToday,
        studentsExpected: expectedToday,
        attendanceRate: expectedToday > 0 ? Math.round((presentToday / expectedToday) * 100) : 0,
        todaysSessions: todaySessions.length,
      }}
      students={{ total: studentsResult.data.length, unavailable: Boolean(studentsResult.error) }}
      sessions={sessionsForMetrics}
      sessionsUnavailable={Boolean(sessionsError)}
      attendanceCounts={attendanceCounts}
      gates={activeGates ?? []}
      gateStats={(activeGates ?? []).map((gate) => ({ ...gate, count: todayGateCounts[gate.id] ?? 0 }))}
      gateStatusesBySession={gateStatusesBySession}
      reports={reportSessions}
      history={reportSessions.slice(0, 8)}
      notifications={notificationsResult.data ?? []}
      notificationsUnavailable={Boolean(notificationsResult.error)}
      attendanceHistoryUnavailable={Boolean(recordsResult.error)}
      scanner={<AttendanceQrScanner sessions={activeSessions} gateOptionsBySession={gateOptionsBySession} timeZone={timeZone} />}
      createForm={<CreateAttendanceForm timeZone={timeZone} gates={activeGates ?? []} />}
      timeZone={timeZone}
      sessionList={(
        <AttendanceSessionList
          sessions={sessionsForMetrics}
          attendanceCounts={attendanceCounts}
          unavailable={Boolean(sessionsError)}
          timeZone={timeZone}
          gateStatusesBySession={gateStatusesBySession}
        />
      )}
    />
  );
}