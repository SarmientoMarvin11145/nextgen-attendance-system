"use client";

export default function GlobalError({ retry }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f2f4ed", color: "#1d2923", fontFamily: "Arial, sans-serif" }}>
        <main style={{ width: "min(100%, 440px)", padding: 32, border: "1px solid #dfe5da", borderRadius: 8, background: "#fffefa" }} role="alert">
          <p style={{ color: "#64816f", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Temporary issue</p>
          <h1 style={{ fontSize: 26, lineHeight: 1.2 }}>We couldn&apos;t load the application</h1>
          <p style={{ color: "#738078", fontSize: 14, lineHeight: 1.6 }}>Check your connection and try again. Your account data has not been changed.</p>
          <button style={{ minHeight: 44, padding: "0 16px", border: 0, borderRadius: 5, color: "#fffefa", background: "#20392f", fontSize: 13, fontWeight: 700, cursor: "pointer" }} type="button" onClick={() => retry()}>Try again</button>
        </main>
      </body>
    </html>
  );
}