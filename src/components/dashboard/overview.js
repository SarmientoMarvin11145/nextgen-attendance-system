const attendanceDays = [
  { day: "Mon", value: 74 },
  { day: "Tue", value: 86 },
  { day: "Wed", value: 68 },
  { day: "Thu", value: 92 },
  { day: "Fri", value: 83 },
];

const recentCheckins = [
  { student: "Student 1048", group: "Year 10 · Cedar", time: "08:02", status: "Present" },
  { student: "Student 2186", group: "Year 11 · Maple", time: "08:06", status: "Present" },
  { student: "Student 0731", group: "Year 9 · Birch", time: "08:14", status: "Late" },
  { student: "Student 1654", group: "Year 12 · Ash", time: "08:18", status: "Present" },
];

const metrics = [
  { label: "Present today", value: "248", note: "of 312 enrolled" },
  { label: "Late arrivals", value: "12", note: "across all groups" },
  { label: "Classes active", value: "18", note: "scheduled today" },
];

export default function Overview() {
  return (
    <div className="page-content">
      <section className="page-heading" aria-labelledby="overview-title">
        <div>
          <p className="eyebrow">Sunday, October 4, 2026</p>
          <h1 className="page-title" id="overview-title">Attendance overview</h1>
          <p className="page-description">A clear read on today&apos;s campus activity.</p>
        </div>
        <span className="sample-label">Sample data</span>
      </section>
      <section className="metric-grid" aria-label="Attendance summary">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <p className="metric-label">{metric.label}</p>
            <p className="metric-value">{metric.value}</p>
            <p className="metric-note">{metric.note}</p>
          </article>
        ))}
      </section>
      <div className="overview-grid">
        <section className="panel" aria-labelledby="weekly-title">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title" id="weekly-title">Weekly attendance</h2>
              <p className="panel-subtitle">Average check-in rate · sample week</p>
            </div>
            <span className="chart-total">81%</span>
          </div>
          <div className="week-chart" role="img" aria-label="Attendance rates: Monday 74%, Tuesday 86%, Wednesday 68%, Thursday 92%, Friday 83%">
            {attendanceDays.map((item) => (
              <div className="chart-day" key={item.day}>
                <div className="chart-bar" style={{ height: `${item.value}%` }} />
                <span className="chart-day-label">{item.day}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="panel" aria-labelledby="checkins-title">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title" id="checkins-title">Recent check-ins</h2>
              <p className="panel-subtitle">Latest arrivals · sample records</p>
            </div>
          </div>
          <div className="checkin-list">
            {recentCheckins.map((checkin) => (
              <div className="checkin-row" key={checkin.student}>
                <p className="checkin-person">{checkin.student}</p>
                <span className="checkin-group">{checkin.group}</span>
                <span className="checkin-time">{checkin.time}</span>
                <span className={`checkin-status${checkin.status === "Late" ? " checkin-status-late" : ""}`}>
                  {checkin.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}