export default function FormField({ id, label, error, ...inputProps }) {
  const errorId = `${id}-error`;

  return (
    <div className="form-field">
      <label className="form-label" htmlFor={id}>{label}</label>
      <input
        className="form-input"
        id={id}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
      />
      {error && <p className="field-error" id={errorId}>{error}</p>}
    </div>
  );
}