"use client";

export default function ReportActions({ csvHref, excelHref, disabled }) {
  return (
    <div className="report-actions">
      <a className={`report-action-link${disabled ? " report-action-disabled" : ""}`} href={disabled ? undefined : csvHref} aria-disabled={disabled}>
        Export CSV
      </a>
      <a className={`report-action-link${disabled ? " report-action-disabled" : ""}`} href={disabled ? undefined : excelHref} aria-disabled={disabled}>
        Export Excel
      </a>
      <button className="report-action-link report-print-button" type="button" onClick={() => window.print()}>
        Print Report
      </button>
    </div>
  );
}