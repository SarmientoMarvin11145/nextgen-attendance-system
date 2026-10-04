"use client";

import { useEffect, useState } from "react";

export default function InstallAppPanel() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const installed = window.matchMedia("(display-mode: standalone)").matches
      || window.navigator.standalone === true;
    setIsInstalled(installed);
    setIsIos(/iPad|iPhone|iPod/.test(navigator.userAgent));

    function handleInstallPrompt(event) {
      event.preventDefault();
      setInstallPrompt(event);
    }

    function handleInstalled() {
      setIsInstalled(true);
      setInstallPrompt(null);
      setMessage("Attendance System was added to your home screen.");
    }

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function installApp() {
    if (!installPrompt) {
      setMessage(isIos
        ? "In Safari, tap Share, then Add to Home Screen."
        : "Use your browser menu and choose Install app or Add to Home Screen.");
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setMessage(choice.outcome === "accepted" ? "Attendance System is being installed." : "Installation was cancelled.");
    setInstallPrompt(null);
  }

  if (isInstalled) return null;

  return (
    <section className="panel install-app-panel" aria-labelledby="install-app-title">
      <div>
        <h2 className="panel-title" id="install-app-title">Install Attendance System</h2>
        <p className="panel-subtitle">Add the app to your phone home screen for quick access.</p>
      </div>
      <button className="report-action-link" type="button" onClick={installApp}>
        {installPrompt ? "Install app" : "Installation instructions"}
      </button>
      {message && <p className="permission-feedback" role="status">{message}</p>}
    </section>
  );
}