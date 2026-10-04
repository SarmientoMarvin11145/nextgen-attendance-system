"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function AttendanceRealtime({ role, userId }) {
  const router = useRouter();

  useEffect(() => {
    let refreshTimer;
    const refresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        router.refresh();
      }, 300);
    };
    const channel = supabase
      .channel(`attendance-dashboard-${userId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "attendance_sessions",
      }, refresh)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "attendance_records",
        ...(role === "student" ? { filter: `student_id=eq.${userId}` } : {}),
      }, refresh)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      }, refresh)
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [role, router, userId]);

  return null;
}