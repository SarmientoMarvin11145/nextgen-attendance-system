import Link from "next/link";
import ReportActions from "@/components/admin/report-actions";
import PendingFilterForm, { PendingFilterSubmit } from "@/components/pending-filter-form";
import { getAttendanceReport, parseAttendanceReportFilters } from "@/lib/reports/attendance-report";

const statItems = [
  ["Total Students", "totalStudents"],
  ["Present", "present"],
  ["Late", "late"],
  ["Absent", "absent"],
  ["Attendance Percentage", "attendancePercentage"],
];

function exportHref(filters, format) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  params.set("format", format);
  return `/api/admin/reports/export?${params.toString()}`;
}

export default async function AttendanceReportsPage({ searchParams }) {
  const params = await searchParams;
  const { filters, rangeError } = parseAttendanceReportFilters(params);
  const report = await getAttendanceReport(filters, { includeOptions: true });
  const options = report.options;
  const displayRecords = report.records.slice(0, 100);
  const hasRecords = report.records.length > 0;
  const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: report.timeZone });
  const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: report.timeZone });

  return (
    <div className="page-content attendance-report-page">
      <section className="page-heading" aria-labelledby="reports-title">
        <div>
          <p className="eyebrow">Attendance operations</p>
          <h1 className="page-title" id="reports-title">Attendance Reports</h1>
          <p className="page-description">Review attendance by date range, session, and student group.</p>
        </div>
        <Link className="topbar-primary history-back-link" href="/admin#reports">Dashboard</Link>
      </section>

      <PendingFilterForm className="report-filters" action="/admin/reports">
        <label className="form-field">
          <span className="form-label">Date from ({report.timeZone})</span>
          <input className="form-input" name="from" type="date" defaultValue={filters.from} />
        </label>
        <label className="form-field">
          <span className="form-label">Date to ({report.timeZone})</span>
          <input className="form-input" name="to" type="date" defaultValue={filters.to} />
        </label>
        {[
          ["course", "Course", options?.courses ?? []],
          ["year", "Year", options?.years ?? []],
          ["block", "Block", options?.blocks ?? []],
          ["team", "Team", options?.teams ?? []],
        ].map(([key, label, values]) => (
          <label className="form-field" key={key}>
            <span className="form-label">{label}</span>
            <select className="form-input" name={key} defaultValue={filters[key]}>
              <option value="">All</option>
              {values.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        ))}
        <label className="form-field report-session-filter">
          <span className="form-label">Attendance Session</span>
          <select className="form-input" name="sessionId" defaultValue={filters.sessionId}>
            <option value="">All sessions</option>
            {(options?.sessions ?? []).map((session) => (
              <option key={session.id} value={session.id}>{session.title} · {dateFormatter.format(new Date(session.start_time))}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span className="form-label">Gate</span>
          <select className="form-input" name="gateId" defaultValue={filters.gateId}>
            <option value="">All gates</option>
            {(options?.gates ?? []).map((gate) => (
              <option key={gate.id} value={gate.id}>{gate.name} · {gate.code}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span className="form-label">Status</span>
          <select className="form-input" name="status" defaultValue={filters.status}>
            <option value="">All</option>
            <option value="present">Present</option>
            <option value="late">Late</option>
            <option value="absent">Absent</option>
          </select>
        </label>
        <div className="history-filter-actions">
          <PendingFilterSubmit className="auth-submit history-apply" pendingLabel="Generating report...">Generate Report</PendingFilterSubmit>
          <Link className="text-link" href="/admin/reports">Clear</Link>
        </div>
      </PendingFilterForm>

      {(rangeError || report.error || options?.error) && (
        <p className="form-feedback form-feedback-error" role="alert">
          {rangeError || report.error || "Report filters are temporarily unavailable."}
        </p>
      )}

      <section className="metric-grid report-stat-grid" aria-label="Report statistics">
        {statItems.map(([label, key]) => (
          <article className="metric-card report-stat-card" key={key}>
            <p className="metric-label">{label}</p>
            <p className="metric-value">{key === "attendancePercentage" ? `${report.stats[key]}%` : report.stats[key].toLocaleString()}</p>
          </article>
        ))}
      </section>

      <section className="panel report-results" aria-labelledby="report-results-title">
        <div className="panel-heading report-results-heading">
          <div>
            <h2 className="panel-title" id="report-results-title">Report Details</h2>
            <p className="panel-subtitle">
              {report.records.length.toLocaleString()} attendance records
              {report.records.length > displayRecords.length ? ` · showing ${displayRecords.length}` : ""}
            </p>
          </div>
          <ReportActions
            csvHref={exportHref(filters, "csv")}
            excelHref={exportHref(filters, "xlsx")}
            disabled={!hasRecords || Boolean(report.error || rangeError)}
          />
        </div>
        {displayRecords.length === 0 ? (
          <p className="empty-state">No attendance records match these filters.</p>
        ) : (
          <>
          {report.truncated && <p className="report-truncated-note">This report reached the 50,000-record export cap. Narrow the date range for a complete report.</p>}
          <div className="history-table-wrap">
            <table className="history-table report-table">
              <thead>
                <tr><th scope="col">Student</th><th scope="col">Course</th><th scope="col">Year</th><th scope="col">Block</th><th scope="col">Team</th><th scope="col">Attendance Session</th><th scope="col">Gate</th><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                {displayRecords.map((record, index) => {
                  const registeredAt = new Date(record.registeredAt);
                  return (
                    <tr key={`${record.registeredAt}-${record.session}-${index}`}>
                      <td>{record.student}</td>
                      <td>{record.course || "—"}</td>
                      <td>{record.year || "—"}</td>
                      <td>{record.block || "—"}</td>
                      <td>{record.team || "—"}</td>
                      <td>{record.session}</td>
                      <td>{record.gate ? `${record.gate} · ${record.gateCode}` : "—"}</td>
                      <td>{dateFormatter.format(registeredAt)}</td>
                      <td>{timeFormatter.format(registeredAt)}</td>
                      <td><span className={`attendance-pill attendance-pill-${record.status}`}>{record.status.toUpperCase()}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>
    </div>
  );
}