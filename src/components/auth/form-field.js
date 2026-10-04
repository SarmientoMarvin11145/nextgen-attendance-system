export default function FormField({ id, label, error, options, placeholder, ...inputProps }) {
  const errorId = `${id}-error`;

  return (
    <div className="form-field">
      <label className="form-label" htmlFor={id}>{label}</label>
      {options ? (
        <select
          className="form-input"
          id={id}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : undefined}
          {...inputProps}
        >
          <option value="">{placeholder ?? `Select ${label.toLowerCase()}`}</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <input
          className="form-input"
          id={id}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? errorId : undefined}
          {...inputProps}
        />
      )}
      {error && <p className="field-error" id={errorId}>{error}</p>}
    </div>
  );
}