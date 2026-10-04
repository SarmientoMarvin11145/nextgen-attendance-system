"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      router.replace("/login");
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [router]);

  return (
    <main className="splash-screen" aria-live="polite" aria-label="Loading startup screen">
      <div className="splash-logo" aria-hidden="true">
        <div className="splash-ring" />
        <div className="splash-mark">
          <span className="splash-n">N</span>
          <span className="splash-g">G</span>
        </div>
      </div>
      <p className="splash-text">NEXTGen Attendance</p>
    </main>
  );
}
