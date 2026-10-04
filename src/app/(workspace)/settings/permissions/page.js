import PermissionManagement from "@/components/settings/permission-management";
import InstallAppPanel from "@/components/settings/install-app-panel";

export default function PermissionSettingsPage() {
  return (
    <>
      <InstallAppPanel />
      <PermissionManagement />
    </>
  );
}