import "server-only";

import { requireProfileRole } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addCalendarDays, zonedDateTimeToIso } from "@/lib/time-zone";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function paramValue(params, key) {
  if (params instanceof URLSearchParams) return params.get(key) ?? "";
  const value = params?.[key];
  return typeof value === "string" ? value : "";
}

function validDate(value) {
  return datePattern.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

export function parseAttendanceReportFilters(params) {
  const rawFrom = paramValue(params, "from");
  const rawTo = paramValue(params, "to");
  const filters = {
    from: validDate(rawFrom) ? rawFrom : "",
    to: validDate(rawTo) ? rawTo : "",
    course: paramValue(params, "course").trim().slice(0, 120),
    year: paramValue(params, "year").trim().slice(0, 40),
    block: paramValue(params, "block").trim().slice(0, 60),
    team: paramValue(params, "team").trim().slice(0, 60),
    sessionId: sessionIdPattern.test(paramValue(params, "sessionId")) ? paramValue(params, "sessionId") : "",
    gateId: sessionIdPattern.test(paramValue(params, "gateId")) ? paramValue(params, "gateId") : "",
    status: ["present", "late", "absent"].includes(paramValue(params, "status")) ? paramValue(params, "status") : "",
  };

  return {
    filters,
    rangeError: filters.from && filters.to && filters.from > filters.to
      ? "End date must be the same as or after the start date."
      : "",
  };
}

function oneRelation(value) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

async function fetchFilterOptions(supabase) {
  const [studentResult, sessionResult, gateResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("course, year, block, team")
      .eq("role", "student"),
    supabase
      .from("attendance_sessions")
      .select("id, title, start_time")
      .order("start_time", { ascending: false })
      .limit(500),
    supabase.rpc("list_staff_attendance_gates"),
  ]);

  const distinct = (key) => [...new Set((studentResult.data ?? []).map((row) => row[key]).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));

  return {
    courses: distinct("course"),
    years: distinct("year"),
    blocks: distinct("block"),
    teams: distinct("team"),
    sessions: sessionResult.data ?? [],
    gates: gateResult.data ?? [],
    error: studentResult.error || sessionResult.error || gateResult.error,
  };
}

export async function getAttendanceReport(filters, { includeOptions = false } = {}) {
  await requireProfileRole(["officer", "admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: configuredTimeZone } = await supabase.rpc("get_school_timezone");
  const timeZone = typeof configuredTimeZone === "string" ? configuredTimeZone : "Asia/Manila";
  let reportError = "";
  let records = [];
  let truncated = false;
  const fromIso = filters.from ? zonedDateTimeToIso(filters.from, "00:00", timeZone) : "";
  const toIso = filters.to ? zonedDateTimeToIso(addCalendarDays(filters.to, 1), "00:00", timeZone) : "";

  if (filters.from && filters.to && filters.from > filters.to) {
    reportError = "End date must be the same as or after the start date.";
  } else if ((filters.from && !fromIso) || (filters.to && !toIso)) {
    reportError = "The selected date range is invalid for the school timezone.";
  } else {
    const buildQuery = () => {
      let query = supabase
        .from("attendance_records")
        .select(`
          id,
          student_id,
          registered_at,
          attendance_status,
          gate_id,
          student:profiles!attendance_records_student_id_fkey(first_name, last_name, course, year, block, team),
          session:attendance_sessions!attendance_records_session_id_fkey(id, title),
          gate:attendance_gates(name, code)
        `)
        .order("registered_at", { ascending: true });

      if (filters.from) {
        query = query.gte("registered_at", fromIso);
      }
      if (filters.to) {
        query = query.lt("registered_at", toIso);
      }
      if (filters.course) query = query.eq("student.course", filters.course);
      if (filters.year) query = query.eq("student.year", filters.year);
      if (filters.block) query = query.eq("student.block", filters.block);
      if (filters.team) query = query.eq("student.team", filters.team);
      if (filters.sessionId) query = query.eq("session_id", filters.sessionId);
      if (filters.gateId) query = query.eq("gate_id", filters.gateId);
      if (filters.status) query = query.eq("attendance_status", filters.status);
      return query;
    };

    for (let offset = 0; offset <= 50_000; offset += 1_000) {
      const { data, error } = await buildQuery().range(offset, offset + 999);
      if (error) {
        reportError = "Attendance report data is temporarily unavailable.";
        records = [];
        break;
      }
      if (offset === 50_000) {
        truncated = Boolean(data?.length);
        break;
      }
      records.push(...(data ?? []));
      if (!data || data.length < 1_000) break;
    }
  }

  const studentIds = new Set();
  const counts = { present: 0, late: 0, absent: 0 };
  const exportDateTimeFormatter = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const normalizedRecords = records.map((record) => {
    const student = oneRelation(record.student);
    const session = oneRelation(record.session);
    const gate = oneRelation(record.gate);
    studentIds.add(record.student_id);
    counts[record.attendance_status] = (counts[record.attendance_status] ?? 0) + 1;

    return {
      student: [student?.first_name, student?.last_name].filter(Boolean).join(" ") || "Student",
      course: student?.course ?? "",
      year: student?.year ?? "",
      block: student?.block ?? "",
      team: student?.team ?? "",
      session: session?.title ?? "Attendance session",
      gate: gate?.name ?? "",
      gateCode: gate?.code ?? "",
      registeredAt: record.registered_at,
      registeredAtDisplay: exportDateTimeFormatter.format(new Date(record.registered_at)),
      status: record.attendance_status,
    };
  });
  const attendanceCount = counts.present + counts.late + counts.absent;
  const attendancePercentage = attendanceCount > 0
    ? Math.round(((counts.present + counts.late) / attendanceCount) * 100)
    : 0;

  return {
    records: normalizedRecords,
    stats: {
      totalStudents: studentIds.size,
      present: counts.present,
      late: counts.late,
      absent: counts.absent,
      attendancePercentage,
    },
    truncated,
    error: reportError,
    timeZone,
    options: includeOptions ? await fetchFilterOptions(supabase) : null,
  };
}