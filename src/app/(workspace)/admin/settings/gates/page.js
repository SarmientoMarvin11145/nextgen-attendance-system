import Link from "next/link";
import SchoolLocationSettings from "@/components/admin/school-location-settings";
import { requireProfileRole } from "@/lib/auth/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AttendanceGatesPage() {
  await requireProfileRole(["admin"]);
  const supabase = await createSupabaseServerClient();
  const { data: gates, error } = await supabase.rpc("admin_list_attendance_gates");

  return (
    <div className="page-content school-locations-page">
      <section className="page-heading" aria-labelledby="attendance-gates-title">
        <div>
          <p className="eyebrow">Attendance settings</p>
          <h1 className="page-title" id="attendance-gates-title">Attendance Gates</h1>
          <p className="page-description">Manage active entrances and their verification radius.</p>
        </div>
        <Link className="topbar-primary history-back-link" href="/admin/settings">Settings</Link>
      </section>
      <SchoolLocationSettings locations={gates ?? []} unavailable={Boolean(error)} />
    </div>
  );
}