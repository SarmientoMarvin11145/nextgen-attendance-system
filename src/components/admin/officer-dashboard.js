import Link from "next/link";

const statItems = [
  ["Active Attendance", "activeAttendance"],
  ["Students Present", "studentsPresent"],
  ["Students Expected", "studentsExpected"],
  ["Attendance Rate", "attendanceRate"],
  ["Today’s Sessions", "todaysSessions"],
];

function formatTime(value, timeZone) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function statusClass(status) {
  return `session-state session-state-${status.toLowerCase()}`;
}

export default function OfficerDashboard({
  profile,
  realtime,
  stats,
  students,
  sessions,
  sessionsUnavailable,
  attendanceCounts,
  gates,
  gateStats,
  gateStatusesBySession,
  reports,
  history,
  notifications,
  notificationsUnavailable,
  attendanceHistoryUnavailable,
  scanner,
  createForm,
  sessionList,
  timeZone,
}) {
  return (
    <div className="page-content officer-dashboard">
      {realtime}
      <section className="page-heading" id="dashboard" aria-labelledby="officer-dashboard-title">
        <div>
          <p className="eyebrow">Attendance operations</p>
          <h1 className="page-title" id="officer-dashboard-title">Dashboard</h1>
          <p className="page-description">Today&apos;s attendance at a glance.</p>
        </div>
        <span className="sample-label">{profile.role === "admin" ? "Administrator" : "Officer"}</span>
      </section>

      <section className="metric-grid officer-metric-grid" aria-label="Attendance statistics">
        {statItems.map(([label, key]) => (
          <article className="metric-card officer-metric-card" key={key}>
            <p className="metric-label">{label}</p>
            <p className="metric-value">{key === "attendanceRate" ? `${stats[key]}%` : stats[key].toLocaleString()}</p>
          </article>
        ))}
      </section>

      {gates?.length > 0 && (
        <section className="officer-section gate-statistics-section" aria-labelledby="gate-statistics-title">
          <div className="officer-section-heading">
            <div>
              <p className="eyebrow">Today's attendance</p>
              <h2 className="panel-title" id="gate-statistics-title">Attendance by Gate</h2>
            </div>
          </div>
          <div className="gate-stat-grid">
            {gateStats.map((gate) => (
              <article className="metric-card gate-stat-card" key={gate.id}>
                <p className="metric-label">{gate.name}</p>
                <p className="gate-stat-code">{gate.code}</p>
                <p className="metric-value">{gate.count.toLocaleString()}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="officer-section" id="qr-scanner" aria-labelledby="scanner-title">
        <div className="officer-section-heading">
          <div>
            <p className="eyebrow">Check-in</p>
            <h2 className="panel-title" id="scanner-title">QR Scanner</h2>
          </div>
        </div>
        <div className="panel scanner-panel">{scanner}</div>
      </section>

      <section className="officer-section" id="attendance-sessions" aria-labelledby="sessions-title">
        <div className="officer-section-heading">
          <div>
            <p className="eyebrow">Schedule</p>
            <h2 className="panel-title" id="sessions-title">Attendance Sessions</h2>
          </div>
        </div>
        <div className="panel create-session-panel">
          <h3 className="panel-title create-session-title">Create Attendance</h3>
          {createForm}
        </div>
        <div className="session-list-section">
          <div className="session-list-heading">
            <h3 className="panel-title">Session schedule</h3>
            <span className="history-count">{sessionsUnavailable ? "Unavailable" : `${sessions.length} sessions`}</span>
          </div>
          {sessionList}
        </div>
      </section>

      <section className="officer-section" id="students" aria-labelledby="students-title">
        <div className="officer-section-heading">
          <div>
            <p className="eyebrow">Enrollment</p>
            <h2 className="panel-title" id="students-title">Students</h2>
          </div>
        </div>
        <article className="metric-card student-count-card">
          <p className="metric-label">Enrolled students</p>
          <p className="metric-value">{students.unavailable ? "—" : students.total.toLocaleString()}</p>
        </article>
      </section>

      <section className="officer-section" id="attendance-history" aria-labelledby="history-title">
        <div className="officer-section-heading">
          <div>
            <p className="eyebrow">Recent activity</p>
            <h2 className="panel-title" id="history-title">Attendance History</h2>
          </div>
        </div>
        <div className="panel officer-table-wrap">
          {attendanceHistoryUnavailable ? (
            <p className="empty-state">Attendance history is temporarily unavailable.</p>
          ) : history.length === 0 ? (
            <p className="empty-state">No attendance history yet.</p>
          ) : (
            <table className="history-table officer-history-table">
              <thead>
                <tr><th scope="col">Session</th><th scope="col">Window</th><th scope="col">Check-ins</th><th scope="col">State</th></tr>
              </thead>
              <tbody>
                {history.map((session) => (
                  <tr key={session.id}>
                    <td>{session.title}</td>
                    <td>{formatTime(session.start_time, timeZone)}</td>
                    <td>{attendanceCounts[session.id] ?? 0}</td>
                    <td><span className={statusClass(session.state)}>{session.state}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="officer-section" id="reports" aria-labelledby="reports-title">
        <div className="officer-section-heading">
          <div>
            <p className="eyebrow">Performance</p>
            <h2 className="panel-title" id="reports-title">Reports</h2>
          </div>
          <Link className="text-link" href="/admin/reports">Open reports</Link>
        </div>
        <div className="panel officer-table-wrap">
          {reports.length === 0 ? (
            <p className="empty-state">Reports will appear when sessions are created.</p>
          ) : (
            <table className="history-table officer-history-table">
              <thead>
                <tr><th scope="col">Session</th><th scope="col">Expected</th><th scope="col">Present</th><th scope="col">Late</th><th scope="col">Rate</th></tr>
              </thead>
              <tbody>
                {reports.slice(0, 8).map((session) => (
                  <tr key={session.id}>
                    <td>{session.title}</td>
                    <td>{session.expectedCount.toLocaleString()}</td>
                    <td>{session.presentCount.toLocaleString()}</td>
                    <td>{session.lateCount.toLocaleString()}</td>
                    <td>{session.expectedCount > 0 ? `${Math.round((session.presentCount / session.expectedCount) * 100)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="officer-section" id="notifications" aria-labelledby="notifications-title">
        <div className="officer-section-heading">
          <div>
            <p className="eyebrow">Updates</p>
            <h2 className="panel-title" id="notifications-title">Notifications</h2>
          </div>
          <span className="history-count">{notificationsUnavailable ? "Unavailable" : `${notifications.length} recent`}</span>
        </div>
        <div className="notification-list">
          {notificationsUnavailable ? (
            <p className="empty-state">Notifications are temporarily unavailable.</p>
          ) : notifications.length === 0 ? (
            <p className="empty-state">No notifications.</p>
          ) : notifications.map((notification) => (
            <article className={`notification-row${notification.is_read ? "" : " notification-unread"}`} key={notification.id}>
              <div>
                <h3 className="notification-title">{notification.title}</h3>
                <p className="notification-message">{notification.message}</p>
              </div>
              <time className="notification-time" dateTime={notification.created_at}>{formatTime(notification.created_at)}</time>
            </article>
          ))}
        </div>
      </section>

      <section className="officer-section" id="profile" aria-labelledby="profile-title">
        <div className="officer-section-heading">
          <div>
            <p className="eyebrow">Account</p>
            <h2 className="panel-title" id="profile-title">Profile</h2>
          </div>
        </div>
        <article className="panel officer-profile">
          <div><span>Name</span><strong>{profile.displayName}</strong></div>
          <div><span>Email</span><strong>{profile.email || "Not provided"}</strong></div>
          <div><span>Role</span><strong>{profile.role}</strong></div>
        </article>
      </section>
    </div>
  );
}