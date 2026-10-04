import { redirect } from "next/navigation";

export default async function SchoolLocationsPage() {
  redirect("/admin/settings/gates");
}