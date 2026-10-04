import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="unauthorized-title">
        <p className="eyebrow">Access restricted</p>
        <h1 className="page-title" id="unauthorized-title">You don&apos;t have access to this area</h1>
        <p className="auth-message">Your account does not have an officer or administrator role.</p>
        <Link className="text-link" href="/dashboard">Return to your dashboard</Link>
      </section>
    </main>
  );
}