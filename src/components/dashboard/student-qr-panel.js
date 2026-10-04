"use client";

import Image from "next/image";
import { useActionState, useEffect, useRef, useState } from "react";
import { issueStudentQr } from "@/app/actions/auth";
import FormFeedback from "@/components/auth/form-feedback";

const initialState = { status: "idle", message: "", sessionId: "", qrDataUrl: "", expiresAt: "" };
const locationConsentKey = "attendance-location-explained";
const offlineMessage = "No Internet Connection. Attendance verification requires an active internet connection. Please reconnect and try again.";

function formatSessionTime(session, timeZone) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });

  return `${formatter.format(new Date(session.start_time))} - ${formatter.format(new Date(session.end_time))}`;
}

function formatCountdown(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatSessionRemaining(totalSeconds) {
  if (totalSeconds <= 0) return "Session ended";
  const minutes = Math.floor(totalSeconds / 60);
  return minutes < 1
    ? "Less than a minute remaining"
    : `${minutes} minute${minutes === 1 ? "" : "s"} remaining`;
}

function SessionRegistration({ session, now, timeZone }) {
  const [state, action, isPending] = useActionState(issueStudentQr, initialState);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const formRef = useRef(null);
  const dialogRef = useRef(null);
  const latitudeInputRef = useRef(null);
  const longitudeInputRef = useRef(null);
  const accuracyInputRef = useRef(null);
  const locationConsentRef = useRef(false);
  const locationRequestRef = useRef(false);
  const submitAfterLocationRef = useRef(false);
  const expiresAt = state.sessionId === session.id ? state.expiresAt : "";
  const remainingSeconds = expiresAt
    ? Math.max(0, Math.ceil((Date.parse(expiresAt) - countdownNow) / 1000))
    : 0;
  const showQr = state.status === "success" && expiresAt && remainingSeconds > 0 && state.qrDataUrl;
  const canRegenerate = Boolean(expiresAt) && remainingSeconds === 0;
  const startAt = Date.parse(session.start_time);
  const endAt = Date.parse(session.end_time);
  const isActive = now >= startAt && now < endAt;
  const isUpcoming = now < startAt;
  const sessionRemainingSeconds = Math.max(0, Math.ceil((endAt - now) / 1000));
  const locationRequirementLabel = session.location_requirement === "required"
    ? "Required"
    : session.location_requirement === "optional" ? "Optional" : "Disabled";

  useEffect(() => {
    if (!expiresAt) {
      return undefined;
    }

    const timer = setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (locationDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!locationDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [locationDialogOpen]);

  useEffect(() => {
    if (state.status === "idle") return;
    latitudeInputRef.current.value = "";
    longitudeInputRef.current.value = "";
    accuracyInputRef.current.value = "";
  }, [state]);

  function hasExplainedLocation() {
    if (locationConsentRef.current) return true;

    try {
      locationConsentRef.current = window.localStorage.getItem(locationConsentKey) === "granted";
    } catch {
      return false;
    }

    return locationConsentRef.current;
  }

  function requestLocation() {
    if (locationRequestRef.current) return;

    if (!navigator.onLine) {
      setLocationDialogOpen(false);
      setLocationError(offlineMessage);
      return;
    }

    if (!navigator.geolocation) {
      setLocationDialogOpen(false);
      setLocationError("Your browser does not support location. Use a modern version of Chrome, Edge, Safari, or Firefox.");
      return;
    }

    locationRequestRef.current = true;
    setIsLocating(true);
    setLocationError("");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        locationRequestRef.current = false;
        setIsLocating(false);
        if (!navigator.onLine) {
          setLocationError(offlineMessage);
          return;
        }
        latitudeInputRef.current.value = String(position.coords.latitude);
        longitudeInputRef.current.value = String(position.coords.longitude);
        accuracyInputRef.current.value = String(position.coords.accuracy);
        locationConsentRef.current = true;
        try {
          window.localStorage.setItem(locationConsentKey, "granted");
        } catch {
          locationConsentRef.current = true;
        }
        setLocationDialogOpen(false);
        submitAfterLocationRef.current = true;
        formRef.current?.requestSubmit();
      },
      (error) => {
        locationRequestRef.current = false;
        setIsLocating(false);
        setLocationDialogOpen(false);
        setLocationError(error.code === 1
          ? "Location Permission Denied. Location permission is required for this session. Enable it in your browser or device settings."
          : error.code === 2
            ? "Location Services Disabled. Please enable location services on your device to register attendance."
            : "Your location could not be determined accurately. Please try again.");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }

  function submitWithoutLocation() {
    if (isPending || locationRequestRef.current) return;
    if (!navigator.onLine) {
      setLocationError(offlineMessage);
      setLocationDialogOpen(false);
      return;
    }

    latitudeInputRef.current.value = "";
    longitudeInputRef.current.value = "";
    accuracyInputRef.current.value = "";
    setLocationError("");
    setLocationDialogOpen(false);
    submitAfterLocationRef.current = true;
    formRef.current?.requestSubmit();
  }

  function handleRegistrationSubmit(event) {
    if (submitAfterLocationRef.current) {
      submitAfterLocationRef.current = false;
      return;
    }

    event.preventDefault();
    if (isPending || locationRequestRef.current) return;

    if (!navigator.onLine) {
      setLocationError(offlineMessage);
      return;
    }

    setLocationError("");
    if (session.location_requirement === "disabled") {
      submitWithoutLocation();
      return;
    }

    if (session.location_requirement === "optional") {
      setLocationDialogOpen(true);
      return;
    }

    if (hasExplainedLocation()) {
      requestLocation();
    } else {
      setLocationDialogOpen(true);
    }
  }

  return (
    <article className="qr-session-row">
      <div className="qr-session-heading">
        <div>
          <h3 className="qr-session-title">{session.title}</h3>
          <p className="panel-subtitle">{formatSessionTime(session, timeZone)}</p>
        </div>
        <span className={`session-available${isActive ? "" : " session-upcoming"}`}>
          {isActive ? "Attendance Available" : isUpcoming ? "Upcoming" : "Session ended"}
        </span>
      </div>
      <div className="session-registration-status">
        <span>Location: {locationRequirementLabel}</span>
        <span>{session.available_gate_count ?? 0} gate{session.available_gate_count === 1 ? "" : "s"} available</span>
        <span>{isActive
          ? formatSessionRemaining(sessionRemainingSeconds)
          : isUpcoming ? "Registration opens at the scheduled time" : "Session ended"}</span>
      </div>
      <form className="qr-form" action={action} ref={formRef} onSubmit={handleRegistrationSubmit}>
        <input type="hidden" name="sessionId" value={session.id} />
        <input type="hidden" name="latitude" ref={latitudeInputRef} />
        <input type="hidden" name="longitude" ref={longitudeInputRef} />
        <input type="hidden" name="accuracy" ref={accuracyInputRef} />
        <button
          className="auth-submit"
          type="submit"
          disabled={!isActive || isPending || isLocating || (Boolean(expiresAt) && remainingSeconds > 0)}
        >
          {isLocating
            ? "Checking location..."
            : isPending
            ? "Generating QR..."
            : !isActive
              ? isUpcoming ? "Register" : "Session ended"
              : canRegenerate
              ? "Regenerate QR"
              : showQr
                ? "QR ready"
                : "Register"}
        </button>
      </form>
      {locationError && (
        <div className="location-result location-result-error" role="alert">
          <p>{locationError}</p>
          {locationError !== offlineMessage && (
            <button className="location-retry" type="button" onClick={requestLocation} disabled={isLocating}>
              {isLocating ? "Checking location..." : "Try Again"}
            </button>
          )}
          {session.location_requirement === "optional" && (
            <button className="location-retry" type="button" onClick={submitWithoutLocation} disabled={isLocating}>
              Continue without location
            </button>
          )}
        </div>
      )}
      <dialog
        className="location-consent-dialog"
        ref={dialogRef}
        aria-labelledby={`location-dialog-title-${session.id}`}
        aria-describedby={`location-dialog-description-${session.id}`}
        onCancel={(event) => {
          event.preventDefault();
          if (!locationRequestRef.current) setLocationDialogOpen(false);
        }}
      >
        <div className="location-dialog-content">
          <p className="eyebrow">Attendance check</p>
          <h2 className="location-dialog-title" id={`location-dialog-title-${session.id}`}>
            {session.location_requirement === "optional" ? "Location Verification (Optional)" : "Location Verification Required"}
          </h2>
          <p className="location-dialog-copy" id={`location-dialog-description-${session.id}`}>
            {session.location_requirement === "optional"
              ? "You can share your device location to verify attendance eligibility, or continue without location verification. Exact coordinates are not stored."
              : "To help prevent attendance registration outside the school, this system needs your device's location while registering attendance. Your location will only be used to verify attendance eligibility; exact coordinates are not stored."}
          </p>
          <div className="location-dialog-actions">
            <button className="location-cancel" type="button" onClick={() => setLocationDialogOpen(false)} disabled={isLocating}>Cancel</button>
            {session.location_requirement === "optional" && (
              <button className="location-cancel" type="button" onClick={submitWithoutLocation} disabled={isLocating}>Continue without location</button>
            )}
            <button className="auth-submit location-allow" type="button" onClick={requestLocation} disabled={isLocating}>
              {isLocating ? "Checking location..." : "Allow Location"}
            </button>
          </div>
        </div>
      </dialog>
      {state.sessionId === session.id && state.status === "error" && (
        <p className="form-feedback form-feedback-error" role="alert">{state.message}</p>
      )}
      {state.sessionId === session.id && ["accuracy_too_low", "outside_area"].includes(state.status) && (
        <section className="location-result location-result-error" role="alert">
          <h4 className="location-result-title">
            {state.status === "accuracy_too_low" ? "Location Accuracy Too Low" : "Registration Failed"}
          </h4>
          <p>{state.message}</p>
          {state.status === "accuracy_too_low" ? (
            <p className="location-result-detail">
              Reported accuracy: {Math.round(state.accuracy)} meters. Required accuracy: {state.maximumAccuracy} meters or better.
            </p>
          ) : (
            <p className="location-result-detail">
              Distance detected: {Math.round(state.distance)} meters. Required: within {state.requiredRadius} meters of a school location.
            </p>
          )}
          <button className="location-retry" type="button" onClick={requestLocation} disabled={isLocating}>
            {isLocating ? "Checking location..." : "Try Again"}
          </button>
        </section>
      )}
      {state.sessionId === session.id && state.status === "location_uncertain" && (
        <section className="location-result location-result-error" role="alert">
          <h4 className="location-result-title">Location Uncertain</h4>
          <p>{state.message}</p>
          <button className="location-retry" type="button" onClick={requestLocation} disabled={isLocating}>
            {isLocating ? "Checking location..." : "Try Again"}
          </button>
        </section>
      )}
      {state.sessionId === session.id && state.status === "already_registered" && (
        <section className="location-result location-result-error" role="status">
          <h4 className="location-result-title">Already Registered</h4>
          <p>{state.message}</p>
        </section>
      )}
      {showQr && (
        <div className="qr-output" aria-live="polite">
          <Image
            className="student-qr-image"
            src={state.qrDataUrl}
            alt={`One-time attendance QR code for ${session.title}`}
            width={224}
            height={224}
            unoptimized
          />
          <p className="qr-countdown-label">QR Code expires in:</p>
          <p className="qr-countdown" aria-live="off">{formatCountdown(remainingSeconds)}</p>
          {state.locationVerified ? (
            <p>Gate verified: {state.gateName || state.gateCode}. Distance: {Math.round(state.distance)} meters (accuracy ±{Math.round(state.accuracy)} meters).</p>
          ) : (
            <p className="location-unverified-note">
              {state.locationReason === "location_disabled"
                ? "Location verification is disabled for this session."
                : state.locationReason === "outside_area"
                  ? `QR issued without location verification. Distance: ${Math.round(state.distance)} meters; radius: ${state.requiredRadius} meters.`
                  : state.locationReason === "accuracy_too_low"
                    ? `QR issued without location verification. Reported accuracy: ${Math.round(state.accuracy)} meters; maximum: ${state.maximumAccuracy} meters.`
                      : state.locationReason === "location_uncertain"
                        ? "QR issued without location verification because the fix was too close to the boundary."
                    : "QR issued without location verification."}
            </p>
          )}
          <p>{state.message}</p>
        </div>
      )}
      {canRegenerate && <p className="qr-expired-message">This code expired. Register again for a new one.</p>}
    </article>
  );
}

export default function StudentQrPanel({ sessions, unavailable, timeZone = "Asia/Manila" }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  if (unavailable) {
    return <p className="empty-state">Open attendance sessions are temporarily unavailable.</p>;
  }

  if (sessions.length === 0) {
    return <p className="empty-state">There are no open attendance sessions right now.</p>;
  }

  return (
    <div className="qr-session-list">
      {sessions.map((session) => <SessionRegistration key={session.id} session={session} now={now} timeZone={timeZone} />)}
    </div>
  );
}