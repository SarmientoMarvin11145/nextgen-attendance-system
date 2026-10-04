"use client";

import { useActionState, useEffect, useState } from "react";
import { setAttendanceSessionGate } from "@/app/actions/attendance";
import FormFeedback from "@/components/auth/form-feedback";

const gateActionInitialState = { status: "idle", message: "" };

function getSessionState(session, attendanceCount, now) {
  if (session.status === "completed") return "Completed";
  if (session.status === "cancelled") return "Expired";
  if (now < Date.parse(session.start_time)) return "Upcoming";
  if (now < Date.parse(session.end_time)) return "Active";
  return attendanceCount > 0 ? "Completed" : "Expired";
}

function SessionGateControl({ sessionId, gate }) {
  const [state, action, isPending] = useActionState(setAttendanceSessionGate, gateActionInitialState);

  return (
    <div className="session-gate-control">
      <span className={`session-gate-status${gate.is_active && gate.is_open ? " session-gate-open" : ""}`}>
        {gate.is_active && gate.is_open ? "Open" : "Closed"}
      </span>
      <form action={action}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="gateId" value={gate.gate_id} />
        <input type="hidden" name="isOpen" value={String(!gate.is_open)} />
        <button className="report-action-link" type="submit" disabled={isPending || !gate.is_active}>
          {isPending ? "Updating..." : gate.is_open ? "Close gate" : "Open gate"}
        </button>
      </form>
      <FormFeedback state={state} />
    </div>
  );
}

export default function AttendanceSessionList({ sessions, attendanceCounts, gateStatusesBySession = {}, unavailable, timeZone = "Asia/Manila" }) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const initialUpdate = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), 60_000);

    return () => {
      clearTimeout(initialUpdate);
      clearInterval(interval);
    };
  }, []);

  if (unavailable) {
    return <p className="empty-state">Attendance sessions are temporarily unavailable.</p>;
  }

  if (sessions.length === 0) {
    return <p className="empty-state">No attendance sessions created yet.</p>;
  }

  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });

  return (
    <div className="session-list">
      {sessions.map((session) => {
        const attendanceCount = attendanceCounts[session.id] ?? 0;
        const state = getSessionState(session, attendanceCount, now);
        const filters = [
          ["Course", session.course_filter],
          ["Year", session.year_filter],
          ["Block", session.block_filter],
          ["Team", session.team_filter],
        ];
        const sessionGates = gateStatusesBySession[session.id] ?? [];

        return (
          <article className="session-card" key={session.id}>
            <div className="session-card-heading">
              <div>
                <h3 className="session-card-title">{session.title}</h3>
                {session.description && <p className="session-card-description">{session.description}</p>}
              </div>
              <span className={`session-state session-state-${state.toLowerCase()}`}>{state}</span>
            </div>
            <p className="session-card-time">
              {dateFormatter.format(new Date(session.start_time))} - {dateFormatter.format(new Date(session.end_time))}
            </p>
            <p className="session-card-audience">
              {filters.map(([label, value]) => `${label}: ${value ?? "All"}`).join(" · ")}
            </p>
            <p className="session-card-count">{attendanceCount} attendance records</p>
            {sessionGates.length > 0 && (
              <details className="session-gate-details">
                <summary>{sessionGates.filter((gate) => gate.is_active && gate.is_open).length} gates open</summary>
                <div className="session-gate-list">
                  {sessionGates.map((gate) => (
                    <div className="session-gate-row" key={gate.gate_id}>
                      <span>{gate.name} · {gate.code}{!gate.is_active ? " · Disabled" : ""}</span>
                      <SessionGateControl sessionId={session.id} gate={gate} />
                    </div>
                  ))}
                </div>
              </details>
            )}
          </article>
        );
      })}
    </div>
  );
}