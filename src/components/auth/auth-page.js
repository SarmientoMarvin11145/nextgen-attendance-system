import Link from "next/link";
import LoginForm from "@/components/auth/login-form";
import RegistrationForm from "@/components/auth/registration-form";

export default function AuthPage({ mode }) {
  const isRegister = mode === "register";

  return (
    <main className="auth-page">
      <section className={`auth-panel${isRegister ? " auth-panel-register" : ""}`} aria-labelledby="auth-title">
        <Link className="brand-lockup" href="/dashboard" aria-label="Attendance workspace home">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>
            <span className="brand-name">Attendance</span>
            <span className="brand-caption">Campus workspace</span>
          </span>
        </Link>
        <p className="eyebrow auth-eyebrow">Student account</p>
        <h1 className="page-title" id="auth-title">{isRegister ? "Create an account" : "Welcome back"}</h1>
        <p className="auth-message">
          {isRegister ? "Enter your details to join the attendance workspace." : "Sign in to continue to your attendance workspace."}
        </p>
        {isRegister ? <RegistrationForm /> : <LoginForm next={next} />}
        <nav className="auth-links" aria-label="Account options">
          {isRegister ? (
            <Link className="text-link" href="/login">Already registered? Sign in</Link>
          ) : (
            <>
              <Link className="text-link" href="/forgot-password">Forgot password?</Link>
              <Link className="text-link" href="/register">Create a student account</Link>
            </>
          )}
          <Link href="/dashboard">Return to the workspace</Link>
        </nav>
      </section>
    </main>
  );
}