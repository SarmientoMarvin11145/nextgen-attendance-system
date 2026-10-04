import { requireProfileRole } from "@/lib/auth/authorization";

export default async function AdminLayout({ children }) {
  await requireProfileRole(["officer", "admin"]);
  return children;
}