import { requireProfileRole } from "@/lib/auth/authorization";

export default async function StudentDashboardLayout({ children }) {
  await requireProfileRole(["student"]);
  return children;
}