"use client";

export default function ErrorPage({ retry }) {
  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="app-error-title" role="alert">
        <p className="eyebrow">Temporary issue</p>
        <h1 className="page-title" id="app-error-title">We couldn&apos;t load this page</h1>
        <p className="auth-message">Check your connection and try again. Your account data has not been changed.</p>
        <button className="auth-submit" type="button" onClick={() => retry()}>Try again</button>
      </section>
    </main>
  );
}