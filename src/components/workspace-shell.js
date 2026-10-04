"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/actions/auth";
import PendingActionButton from "@/components/pending-action-button";

const studentNavigation = [
  { href: "/dashboard", label: "Dashboard", index: "01" },
  { href: "/dashboard#attendance-history", label: "Attendance", index: "02" },
  { href: "/notifications", label: "Notifications", index: "03" },
  { href: "/dashboard#personal-info", label: "Profile", index: "04" },
  { href: "/settings/permissions", label: "Permissions", index: "05" },
];

const staffNavigation = [
  { href: "/admin#dashboard", label: "Dashboard", index: "01" },
  { href: "/admin#qr-scanner", label: "QR Scanner", index: "02" },
  { href: "/admin#attendance-sessions", label: "Attendance Sessions", index: "03" },
  { href: "/admin#students", label: "Students", index: "04" },
  { href: "/admin/history", label: "Attendance History", index: "05" },
  { href: "/admin/reports", label: "Reports", index: "06" },
  { href: "/notifications", label: "Notifications", index: "07" },
  { href: "/admin#profile", label: "Profile", index: "08" },
  { href: "/settings/permissions", label: "Permissions", index: "09" },
];
const adminNavigation = [
  ...staffNavigation,
  { href: "/admin/settings", label: "Settings", index: "10" },
];

export default function WorkspaceShell({ children, role, unreadNotificationCount = 0 }) {
  const pathname = usePathname();
  const visibleNavigation = role === "student"
    ? studentNavigation
    : role === "admin" ? adminNavigation : staffNavigation;
  const homeHref = role === "student" ? "/dashboard" : "/admin";

  return (
    <div className="workspace-shell">
      <aside className="sidebar">
        <Link className="brand-lockup" href={homeHref} aria-label="Attendance workspace home">
          <span className="brand-mark" aria-hidden="true">
            <Image src="/logo.jpg" alt="Attendance logo" width={38} height={38} />
          </span>
          <span>
            <span className="brand-name">Attendance</span>
            <span className="brand-caption">Campus workspace</span>
          </span>
        </Link>
        <p className="nav-caption">Workspace</p>
        <nav className="primary-nav" aria-label="Main navigation">
          {visibleNavigation.map((item) => {
            const isActive = pathname === item.href
              || (role !== "student" && pathname === "/admin" && item.href === "/admin#dashboard");

            return (
              <Link key={item.href} className="nav-link" href={item.href} aria-current={isActive ? "page" : undefined}>
                <span className="nav-index" aria-hidden="true">{item.index}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <p className="sidebar-footnote">Environment</p>
          <p className="sidebar-term">Development workspace</p>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <span className="topbar-label">Attendance System</span>
          <nav className="topbar-actions" aria-label="Account navigation">
            {role ? (
              <>
                <Link
                  className="notification-bell"
                  href="/notifications"
                  aria-label={unreadNotificationCount > 0 ? `Notifications, ${unreadNotificationCount} unread` : "Notifications"}
                >
                  <span aria-hidden="true">🔔</span>
                  {unreadNotificationCount > 0 && (
                    <span className="notification-badge" aria-hidden="true">
                      {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                    </span>
                  )}
                </Link>
                <Link className="account-link" href={role === "student" ? "/dashboard#personal-info" : "/admin#profile"}>Profile</Link>
                <form action={signOut}>
                  <PendingActionButton className="topbar-primary topbar-button" pendingLabel="Signing out...">Logout</PendingActionButton>
                </form>
              </>
            ) : (
              <>
                <Link href="/login">Sign in</Link>
                <Link className="topbar-primary" href="/register">Create account</Link>
              </>
            )}
          </nav>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}