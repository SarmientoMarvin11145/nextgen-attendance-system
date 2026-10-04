"use client";

import { BrowserQRCodeReader } from "@zxing/browser";
import { useEffect, useRef, useState } from "react";
import { registerAttendanceFromQr } from "@/app/actions/attendance";

export default function AttendanceQrScanner({ sessions = [], gateOptionsBySession = {}, timeZone = "Asia/Manila" }) {
  const initialSessionId = sessions[0]?.id ?? "";
  const [selectedSessionId, setSelectedSessionId] = useState(initialSessionId);
  const [selectedGateId, setSelectedGateId] = useState(() => gateOptionsBySession[initialSessionId]?.[0]?.gate_id ?? "");
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const processingRef = useRef(false);
  const [scanStatus, setScanStatus] = useState("idle");
  const [scanResult, setScanResult] = useState(null);
  const [cameraError, setCameraError] = useState("");

  useEffect(() => () => controlsRef.current?.stop(), []);

  async function startScanner() {
    if (!selectedSessionId || !selectedGateId) return;
    processingRef.current = false;
    setScanResult(null);
    setCameraError("");
    setScanStatus("starting");

    try {
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        async (result, _error, callbackControls) => {
          if (!result || processingRef.current) return;

          processingRef.current = true;
          callbackControls?.stop();
          controlsRef.current?.stop();
          setScanStatus("processing");

          try {
            const response = await registerAttendanceFromQr(result.getText(), selectedSessionId, selectedGateId);
            setScanResult(response);
            setScanStatus(response.status);
          } catch {
            setCameraError("The scanned code could not be checked. Try again.");
            setScanStatus("error");
          } finally {
            controlsRef.current = null;
          }
        }
      );

      controlsRef.current = controls;
      if (processingRef.current) controls.stop();
      else setScanStatus("scanning");
    } catch (error) {
      controlsRef.current?.stop();
      controlsRef.current = null;
      setCameraError(error?.name === "NotAllowedError"
        ? "Allow camera access to scan an attendance QR code."
        : "The camera could not be started. Check browser permissions and try again.");
      setScanStatus("error");
    }
  }

  function stopScanner() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanStatus("idle");
    setScanResult(null);
    setCameraError("");
  }

  function changeSession(event) {
    const nextSessionId = event.target.value;
    setSelectedSessionId(nextSessionId);
    setSelectedGateId(gateOptionsBySession[nextSessionId]?.[0]?.gate_id ?? "");
  }

  const scanning = scanStatus === "starting" || scanStatus === "scanning" || scanStatus === "processing";
  const selectedGates = gateOptionsBySession[selectedSessionId] ?? [];
  const studentName = [scanResult?.firstName, scanResult?.lastName].filter(Boolean).join(" ") || "Student";
  const formattedTime = scanResult?.registeredAt
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(scanResult.registeredAt))
    : "";

  return (
    <div className="attendance-scanner">
      <video className="scanner-video" ref={videoRef} autoPlay muted playsInline aria-label="Camera view for attendance QR scanning" />
      <div className="scanner-controls">
        <p className="scanner-hint" role="status" aria-live="polite">
          {scanStatus === "scanning" ? "Scanning..." : scanStatus === "processing" ? "Recording attendance..." : "Scan a student's temporary code while its attendance session is open."}
        </p>
        <label className="form-field scanner-select-field">
          <span className="form-label">Attendance session</span>
          <select className="form-input" value={selectedSessionId} onChange={changeSession} disabled={scanning}>
            <option value="">Select a session</option>
            {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
          </select>
        </label>
        <label className="form-field scanner-select-field">
          <span className="form-label">Operating gate</span>
          <select className="form-input" value={selectedGateId} onChange={(event) => setSelectedGateId(event.target.value)} disabled={scanning || selectedGates.length === 0}>
            <option value="">Select a gate</option>
            {selectedGates.map((gate) => <option key={gate.gate_id} value={gate.gate_id}>{gate.name} · {gate.code}</option>)}
          </select>
        </label>
        <button className="auth-submit scanner-button" type="button" onClick={scanning ? stopScanner : startScanner} disabled={scanStatus === "starting" || scanStatus === "processing" || !selectedSessionId || !selectedGateId}>
          {scanStatus === "starting" ? "Starting camera..." : scanStatus === "processing" ? "Recording attendance..." : scanning ? "Stop scanner" : scanResult ? "Scan another QR" : "Start scanner"}
        </button>
      </div>
      {cameraError && <p className="form-feedback form-feedback-error" role="alert">{cameraError}</p>}
      {scanResult?.status === "recorded" && (
        <section className="scan-result scan-result-success" role="status" aria-labelledby="scan-result-title">
          <p className="eyebrow">Attendance Recorded</p>
          <h3 className="scan-result-name" id="scan-result-title">{studentName}</h3>
          <dl className="scan-student-details">
            <div><dt>Course</dt><dd>{scanResult.course || "Not provided"}</dd></div>
            <div><dt>Year</dt><dd>{scanResult.year || "Not provided"}</dd></div>
            <div><dt>Block</dt><dd>{scanResult.block || "Not provided"}</dd></div>
            <div><dt>Team</dt><dd>{scanResult.team || "Not provided"}</dd></div>
          </dl>
          <p className="scan-result-meta">Status: <strong>{scanResult.attendanceStatus?.toUpperCase()}</strong></p>
          <p className="scan-result-meta">Time: <strong>{formattedTime}</strong></p>
          {scanResult.gateName && <p className="scan-result-meta">Gate: <strong>{scanResult.gateName} · {scanResult.gateCode}</strong></p>}
        </section>
      )}
      {scanResult?.status === "already_recorded" && (
        <section className="scan-result scan-result-duplicate" role="status" aria-labelledby="scan-result-title">
          <p className="eyebrow">Already Recorded</p>
          <h3 className="scan-result-name" id="scan-result-title">
            {scanResult.firstName || scanResult.lastName ? `${studentName} has already taken attendance.` : scanResult.message || "Attendance has already been recorded."}
          </h3>
        </section>
      )}
      {scanResult?.status === "invalid" && <p className="form-feedback form-feedback-error" role="alert">Invalid or Expired QR Code</p>}
      {scanResult?.status === "error" && <p className="form-feedback form-feedback-error" role="alert">{scanResult.message}</p>}
    </div>
  );
}