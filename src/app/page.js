"use client";

import Image from "next/image";
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
      <div className="splash-logo-wrap">
        <Image
          src="/logo.jpg"
          alt="NEXTGen Attendance logo"
          width={520}
          height={520}
          priority
          className="splash-logo"
        />
      </div>
    </main>
  );
}
