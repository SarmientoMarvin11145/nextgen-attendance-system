import Link from "next/link";
import PendingFilterForm, { PendingFilterSubmit } from "@/components/pending-filter-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addCalendarDays, zonedDateTimeToIso } from "@/lib/time-zone";

const PAGE_SIZE = 25;
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${formatHour(hour)} - ${formatHour(hour + 1)}`,
}));

function formatHour(hour) {
  const normalizedHour = hour % 24;
  const suffix = normalizedHour >= 12 ? "PM" : "AM";
  const displayHour = normalizedHour % 12 || 12;
  return `${displayHour}:00 ${suffix}`;
}

function stringParam(params, key) {
  return typeof params[key] === "string" ? params[key].trim() : "";
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

async function fetchStudentOptions(supabase) {
  const rows = [];

  for (let offset = 0; offset < 50_000; offset += 1_000) {
    const { data, error } = await supabase
      .from("profiles")
      .select("course, year, block, team")
      .eq("role", "student")
      .range(offset, offset + 999);

    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < 1_000) break;
  }

  return { rows, error: null };
}

function distinctValues(rows, key) {
  return [...new Set(rows.map((row) => row[key]).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function makePageHref(filters, page) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  params.set("page", String(page));
  return `/admin/history?${params.toString()}`;
}

export default async function AttendanceHistoryPage({ searchParams }) {
  const params = await searchParams;
  const filters = {
    q: stringParam(params, "q").replace(/[^\p{L}\p{M}\p{N} @._'+-]/gu, "").slice(0, 100),
    day: validDate(stringParam(params, "day")) ? stringParam(params, "day") : "",
    hour: /^(?:[0-9]|1[0-9]|2[0-3])$/.test(stringParam(params, "hour")) ? stringParam(params, "hour") : "",
    course: stringParam(params, "course").slice(0, 120),
    year: stringParam(params, "year").slice(0, 40),
    block: stringParam(params, "block").slice(0, 60),
    team: stringParam(params, "team").slice(0, 60),
    gateId: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stringParam(params, "gateId")) ? stringParam(params, "gateId") : "",
    status: ["present", "late", "absent"].includes(stringParam(params, "status")) ? stringParam(params, "status") : "",
    sort: stringParam(params, "sort") === "oldest" ? "oldest" : "newest",
  };
  const requestedPage = Number.parseInt(stringParam(params, "page"), 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100_000) : 1;
  const supabase = await createSupabaseServerClient();
  const { data: configuredTimeZone } = await supabase.rpc("get_school_timezone");
  const timeZone = typeof configuredTimeZone === "string" ? configuredTimeZone : "Asia/Manila";
  const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone });
  const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone });
  const [optionsResult, gateOptionsResult] = await Promise.all([
    fetchStudentOptions(supabase),
    supabase.rpc("list_staff_attendance_gates"),
  ]);
  const start = (page - 1) * PAGE_SIZE;
  let query = supabase
    .from("attendance_records")
    .select(`
      id,
      registered_at,
      attendance_status,
      gate_id,
      student:profiles!attendance_records_student_id_fkey(first_name, last_name, email, course, year, block, team, status),
      session:attendance_sessions!attendance_records_session_id_fkey(title),
      gate:attendance_gates(name, code),
      scanner:profiles!attendance_records_scanned_by_fkey(first_name, last_name)
    `, { count: "exact" })
    .order("registered_at", { ascending: filters.sort === "oldest" });

  if (filters.q) {
    query = query.or(
      `first_name.ilike.%${filters.q}%,last_name.ilike.%${filters.q}%,email.ilike.%${filters.q}%`,
      { referencedTable: "student" }
    );
  }
  if (filters.course) query = query.eq("student.course", filters.course);
  if (filters.year) query = query.eq("student.year", filters.year);
  if (filters.block) query = query.eq("student.block", filters.block);
  if (filters.team) query = query.eq("student.team", filters.team);
  if (filters.gateId) query = query.eq("gate_id", filters.gateId);
  if (filters.status) query = query.eq("attendance_status", filters.status);

  if (filters.day) {
    const startAt = filters.hour
      ? zonedDateTimeToIso(filters.day, `${filters.hour.padStart(2, "0")}:00`, timeZone)
      : zonedDateTimeToIso(filters.day, "00:00", timeZone);
    const nextHour = filters.hour ? Number(filters.hour) + 1 : null;
    const endAt = filters.hour
      ? nextHour < 24
        ? zonedDateTimeToIso(filters.day, `${String(nextHour).padStart(2, "0")}:00`, timeZone)
        : zonedDateTimeToIso(addCalendarDays(filters.day, 1), "00:00", timeZone)
      : zonedDateTimeToIso(addCalendarDays(filters.day, 1), "00:00", timeZone);
    if (startAt && endAt) {
      query = query.gte("registered_at", startAt).lt("registered_at", endAt);
    }
  }

  const { data: records, count, error } = await query.range(start, start + PAGE_SIZE - 1);
  const totalRecords = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));

  return (
    <div className="page-content student-directory-page">
      <section className="page-heading" aria-labelledby="history-page-title">
        <div>
          <p className="eyebrow">Attendance operations</p>
          <h1 className="page-title" id="history-page-title">Attendance History</h1>
          <p className="page-description">Search check-ins by student, session, date, or academic group.</p>
        </div>
        <Link className="topbar-primary history-back-link" href="/admin#dashboard">Dashboard</Link>
      </section>

      <PendingFilterForm className="history-filters" action="/admin/history">
        <label className="form-field history-search-field">
          <span className="form-label">Search student</span>
          <input className="form-input" name="q" type="search" maxLength={100} defaultValue={filters.q} placeholder="Name or email" />
        </label>
        <label className="form-field">
          <span className="form-label">Day ({timeZone})</span>
          <input className="form-input" name="day" type="date" defaultValue={filters.day} />
        </label>
        <label className="form-field">
          <span className="form-label">Hour ({timeZone})</span>
          <select className="form-input" name="hour" defaultValue={filters.hour} disabled={!filters.day}>
            <option value="">All hours</option>
            {HOUR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {[
          ["course", "Course", optionsResult.rows, "course"],
          ["year", "Year", optionsResult.rows, "year"],
          ["block", "Block", optionsResult.rows, "block"],
          ["team", "Team", optionsResult.rows, "team"],
        ].map(([key, label, rows, field]) => (
          <label className="form-field" key={key}>
            <span className="form-label">{label}</span>
            <select className="form-input" name={key} defaultValue={filters[key]}>
              <option value="">All</option>
              {distinctValues(rows, field).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        ))}
        <label className="form-field">
          <span className="form-label">Status</span>
          <select className="form-input" name="status" defaultValue={filters.status}>
            <option value="">All</option>
            <option value="present">Present</option>
            <option value="late">Late</option>
            <option value="absent">Absent</option>
          </select>
        </label>
        <label className="form-field">
          <span className="form-label">Gate</span>
          <select className="form-input" name="gateId" defaultValue={filters.gateId}>
            <option value="">All gates</option>
            {(gateOptionsResult.data ?? []).map((gate) => <option key={gate.id} value={gate.id}>{gate.name} · {gate.code}</option>)}
          </select>
        </label>
        <label className="form-field">
          <span className="form-label">Sort by time</span>
          <select className="form-input" name="sort" defaultValue={filters.sort}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
        <div className="history-filter-actions">
          <PendingFilterSubmit className="auth-submit history-apply" pendingLabel="Loading attendance history...">Apply Filters</PendingFilterSubmit>
          <Link className="text-link" href="/admin/history">Clear</Link>
        </div>
      </PendingFilterForm>

      <section className="panel directory-results" aria-labelledby="results-title">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title" id="results-title">Registered attendance</h2>
            <p className="panel-subtitle">{error ? "Records unavailable" : `${totalRecords.toLocaleString()} records`}</p>
          </div>
          {optionsResult.error && <span className="history-count">Filter options unavailable</span>}
        </div>
        {error ? (
          <p className="empty-state">Attendance history is temporarily unavailable.</p>
        ) : records?.length ? (
          <div className="history-table-wrap">
            <table className="history-table directory-table">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Email</th>
                  <th scope="col">Course</th>
                  <th scope="col">Year</th>
                  <th scope="col">Block</th>
                  <th scope="col">Team</th>
                  <th scope="col">Attendance Session</th>
                  <th scope="col">Gate</th>
                  <th scope="col">Date</th>
                  <th scope="col">Time</th>
                  <th scope="col">Status</th>
                  <th scope="col">Scanned By</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const student = Array.isArray(record.student) ? record.student[0] : record.student;
                  const session = Array.isArray(record.session) ? record.session[0] : record.session;
                  const gate = Array.isArray(record.gate) ? record.gate[0] : record.gate;
                  const scanner = Array.isArray(record.scanner) ? record.scanner[0] : record.scanner;
                  const studentName = [student?.first_name, student?.last_name].filter(Boolean).join(" ") || "Student";
                  const scannerName = [scanner?.first_name, scanner?.last_name].filter(Boolean).join(" ");
                  const registeredAt = new Date(record.registered_at);

                  return (
                    <tr key={record.id}>
                      <td>{studentName}</td>
                      <td>{student?.email ?? "—"}</td>
                      <td>{student?.course ?? "—"}</td>
                      <td>{student?.year ?? "—"}</td>
                      <td>{student?.block ?? "—"}</td>
                      <td>{student?.team ?? "—"}</td>
                      <td>{session?.title ?? "Attendance session"}</td>
                      <td>{gate ? `${gate.name} · ${gate.code}` : "—"}</td>
                      <td>{dateFormatter.format(registeredAt)}</td>
                      <td>{timeFormatter.format(registeredAt)}</td>
                      <td><span className={`attendance-pill attendance-pill-${record.attendance_status}`}>{record.attendance_status.toUpperCase()}</span></td>
                      <td>{scannerName || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">No attendance records match these filters.</p>
        )}
        <nav className="pagination" aria-label="Attendance history pages">
          <span className="history-count">Page {Math.min(page, totalPages)} of {totalPages}</span>
          <div className="pagination-links">
            {page > 1 && <Link className="pagination-link" href={makePageHref(filters, page - 1)}>Previous</Link>}
            {page < totalPages && <Link className="pagination-link" href={makePageHref(filters, page + 1)}>Next</Link>}
          </div>
        </nav>
      </section>
    </div>
  );
}