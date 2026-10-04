"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import TestNotificationButton from "@/components/notifications/test-notification-button";

const initialPermissions = { location: "checking", notifications: "checking", camera: "checking" };

function displayStatus(status) {
  if (status === "granted") return "Allowed";
  if (status === "denied") return "Denied";
  if (status === "prompt" || status === "default") return "Not requested";
  if (status === "unsupported") return "Unsupported";
  if (status === "checking") return "Checking";
  return "Unknown";
}

async function queryPermission(name) {
  if (!navigator.permissions?.query) return "unknown";
  try {
    return (await navigator.permissions.query({ name })).state;
  } catch {
    return "unknown";
  }
}

export default function PermissionManagement() {
  const [permissions, setPermissions] = useState(initialPermissions);
  const [locationMessage, setLocationMessage] = useState("");
  const [cameraMessage, setCameraMessage] = useState("");
  const [isCheckingLocation, setIsCheckingLocation] = useState(false);
  const [isCheckingCamera, setIsCheckingCamera] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const [location, camera] = await Promise.all([
        queryPermission("geolocation"),
        queryPermission("camera"),
      ]);
      const notifications = "Notification" in window
        && "serviceWorker" in navigator
        && "PushManager" in window
        ? Notification.permission
        : "unsupported";
      setPermissions({
        location: "geolocation" in navigator ? location : "unsupported",
        notifications,
        camera: navigator.mediaDevices?.getUserMedia ? camera : "unsupported",
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  function recheckLocation() {
    setLocationMessage("");
    if (!navigator.geolocation) {
      setPermissions((current) => ({ ...current, location: "unsupported" }));
      return;
    }

    setIsCheckingLocation(true);
    navigator.geolocation.getCurrentPosition(
      () => {
        setIsCheckingLocation(false);
        setPermissions((current) => ({ ...current, location: "granted" }));
        setLocationMessage("Location is available. The test reading was not saved.");
      },
      (error) => {
        setIsCheckingLocation(false);
        if (error.code === 1) {
          setPermissions((current) => ({ ...current, location: "denied" }));
          setLocationMessage("Location Permission Denied. Enable it in your browser or device settings; this app cannot change that setting.");
        } else if (error.code === 2) {
          setLocationMessage("Location Services Disabled. Enable location services on your device and try again.");
        } else {
          setLocationMessage("Your location could not be determined. Check device location services and try again.");
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }

  async function testCamera() {
    setCameraMessage("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissions((current) => ({ ...current, camera: "unsupported" }));
      setCameraMessage("Your browser does not support camera access. Use a current version of Chrome, Edge, Safari, or Firefox.");
      return;
    }

    setIsCheckingCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      setPermissions((current) => ({ ...current, camera: "granted" }));
      setCameraMessage("Camera access is available. The test stream has been stopped.");
    } catch (error) {
      setPermissions((current) => ({ ...current, camera: error.name === "NotAllowedError" ? "denied" : "unknown" }));
      setCameraMessage(error.name === "NotAllowedError"
        ? "Camera permission is denied. Enable it in your browser or device settings; this app cannot change that setting."
        : "The camera could not be opened. Check that a camera is available and try again.");
    } finally {
      setIsCheckingCamera(false);
    }
  }

  return (
    <div className="page-content permission-management-page">
      <section className="page-heading" aria-labelledby="permissions-title">
        <div>
          <p className="eyebrow">Settings</p>
          <h1 className="page-title" id="permissions-title">Permissions</h1>
          <p className="page-description">Review and test browser access. Permission prompts occur only after you choose an action.</p>
        </div>
        <Link className="topbar-primary history-back-link" href="/notifications/settings">Notification settings</Link>
      </section>
      <section className="panel permission-list" aria-label="Browser permissions">
        <article className="permission-row">
          <div>
            <h2 className="panel-title">Location</h2>
            <p className="panel-subtitle">Status: {displayStatus(permissions.location)}</p>
            {permissions.location === "denied" && <p className="permission-help">Enable location in browser or device settings. Permission controls cannot be bypassed here.</p>}
            {permissions.location === "unsupported" && <p className="permission-help">Your browser does not support geolocation. Use a modern version of Chrome, Edge, Safari, or Firefox.</p>}
            {locationMessage && <p className="permission-feedback" role="status">{locationMessage}</p>}
          </div>
          <button className="report-action-link" type="button" onClick={recheckLocation} disabled={isCheckingLocation || permissions.location === "unsupported"}>
            {isCheckingLocation ? "Checking..." : "Re-check"}
          </button>
        </article>
        <article className="permission-row">
          <div>
            <h2 className="panel-title">Notifications</h2>
            <p className="panel-subtitle">Status: {displayStatus(permissions.notifications)}</p>
            {permissions.notifications === "denied" && <p className="permission-help">Notifications are blocked. Change this site&apos;s notification permission in browser or device settings.</p>}
            {permissions.notifications === "unsupported" && <p className="permission-help">Your browser does not support Web Push. Use a modern version of Chrome, Edge, Safari, or Firefox.</p>}
          </div>
          {permissions.notifications === "granted"
            ? <TestNotificationButton />
            : <Link className="report-action-link" href="/notifications/settings">Manage</Link>}
        </article>
        <article className="permission-row">
          <div>
            <h2 className="panel-title">Camera</h2>
            <p className="panel-subtitle">Status: {displayStatus(permissions.camera)}</p>
            {permissions.camera === "denied" && <p className="permission-help">Camera permission is denied. Enable it in browser or device settings; this app cannot change that setting.</p>}
            {permissions.camera === "unsupported" && <p className="permission-help">Your browser does not support camera access. Use a modern version of Chrome, Edge, Safari, or Firefox.</p>}
            {cameraMessage && <p className="permission-feedback" role="status">{cameraMessage}</p>}
          </div>
          <button className="report-action-link" type="button" onClick={testCamera} disabled={isCheckingCamera || permissions.camera === "unsupported"}>
            {isCheckingCamera ? "Testing..." : "Test Camera"}
          </button>
        </article>
      </section>
    </div>
  );
}