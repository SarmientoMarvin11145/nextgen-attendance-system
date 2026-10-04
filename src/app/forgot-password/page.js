import Image from "next/image";
import Link from "next/link";
import ForgotPasswordForm from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="forgot-password-title">
        <Link className="brand-lockup" href="/login" aria-label="Return to sign in">
          <span className="brand-mark" aria-hidden="true">
            <Image src="/logo.jpg" alt="Attendance logo" width={38} height={38} />
          </span>
          <span><span className="brand-name">Attendance</span><span className="brand-caption">Campus workspace</span></span>
        </Link>
        <p className="eyebrow auth-eyebrow">Account recovery</p>
        <h1 className="page-title" id="forgot-password-title">Reset your password</h1>
        <p className="auth-message">Enter your account email to receive reset instructions.</p>
        <ForgotPasswordForm />
        <nav className="auth-links" aria-label="Account options">
          <Link className="text-link" href="/login">Return to sign in</Link>
        </nav>
      </section>
    </main>
  );
}