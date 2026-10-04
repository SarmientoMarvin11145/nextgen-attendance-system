import Link from "next/link";
import StudentQrPanel from "@/components/dashboard/student-qr-panel";
import StudentProfileForm from "@/components/dashboard/student-profile-form";

const statusLabels = {
  present: "Present",
  late: "Late",
  absent: "Absent",
};

export default function StudentDashboard({
  profile,
  sessions,
  sessionsUnavailable,
  history,
  historyUnavailable,
  timeZone,
  formatDate,
  formatTime,
}) {
  const initials = profile.displayName.slice(0, 1).toUpperCase() || "S";
  const studentFirstName = profile.first_name || profile.displayName.split(" ")[0] || "there";
  const academicSummary = [profile.course, profile.year, profile.block].filter(Boolean).join(" · ");

  return (
    <div className="page-content student-dashboard">
      <section className="page-heading" aria-labelledby="student-dashboard-title">
        <div>
          <p className="eyebrow">Student workspace</p>
          <h1 className="page-title" id="student-dashboard-title">Welcome, {studentFirstName}!</h1>
          <p className="page-description">Here&apos;s your attendance at a glance.</p>
        </div>
        <nav className="student-section-nav" aria-label="Dashboard sections">
          <Link href="#personal-info">Personal info</Link>
          <Link href="#qr-code">QR code</Link>
          <Link href="#attendance-history">Attendance history</Link>
        </nav>
      </section>

      <div className="student-dashboard-grid">
        <section className="panel student-panel" id="personal-info" aria-labelledby="personal-info-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Profile</p>
              <h2 className="panel-title" id="personal-info-title">Personal info</h2>
            </div>
            <span className="student-avatar" aria-hidden="true">{initials}</span>
          </div>
          <div className="student-summary">
            <p className="student-name">{profile.displayName}</p>
            <p className="student-academic-line">{academicSummary || "Academic details not provided"}</p>
            {profile.team && <p className="student-team-line">{profile.team}</p>}
            <p className="student-email-line">{profile.email}</p>
          </div>
          <details className="profile-edit-details">
            <summary>Edit personal information</summary>
            <StudentProfileForm profile={profile} />
          </details>
        </section>

        <section className="panel student-panel" id="qr-code" aria-labelledby="qr-code-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Check in</p>
              <h2 className="panel-title" id="qr-code-title">Attendance</h2>
              <p className="panel-subtitle">Register for an active session with a temporary QR.</p>
            </div>
          </div>
          <StudentQrPanel sessions={sessions} unavailable={sessionsUnavailable} timeZone={timeZone} />
        </section>
      </div>

      <section className="panel student-panel history-panel" id="attendance-history" aria-labelledby="history-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Record</p>
            <h2 className="panel-title" id="history-title">Attendance history</h2>
            <p className="panel-subtitle">Your latest attendance records.</p>
          </div>
          <span className="history-count">{historyUnavailable ? "Unavailable" : `${history.length} records`}</span>
        </div>
        {historyUnavailable ? (
          <p className="empty-state">Attendance history is temporarily unavailable.</p>
        ) : history.length === 0 ? (
          <p className="empty-state">No attendance history yet.</p>
        ) : (
          <div className="student-history-list">
            {history.map((record) => (
              <article className="student-history-row" key={record.id}>
                <div className="student-history-copy">
                  <h3 className="student-history-title">{record.sessionTitle}</h3>
                  <p className="student-history-time">{formatDate(record.registered_at)} · {formatTime(record.registered_at)}</p>
                  <ul className="verification-badges" aria-label="Attendance verification">
                    <li>QR Verified</li>
                    {record.location_verified && <li>Location Verified</li>}
                  </ul>
                </div>
                <span className={`attendance-pill attendance-pill-${record.attendance_status}`}>
                  {statusLabels[record.attendance_status] ?? record.attendance_status}
                </span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}