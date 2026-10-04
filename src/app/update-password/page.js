import Link from "next/link";
import UpdatePasswordForm from "@/components/auth/update-password-form";
import { requireAuthenticatedProfile } from "@/lib/auth/authorization";

export default async function UpdatePasswordPage() {
  await requireAuthenticatedProfile();

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="update-password-title">
        <Link className="brand-lockup" href="/login" aria-label="Return to sign in">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span><span className="brand-name">Attendance</span><span className="brand-caption">Campus workspace</span></span>
        </Link>
        <p className="eyebrow auth-eyebrow">Account recovery</p>
        <h1 className="page-title" id="update-password-title">Choose a new password</h1>
        <p className="auth-message">Set a new password for your account.</p>
        <UpdatePasswordForm />
      </section>
    </main>
  );
}