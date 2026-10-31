export function AdminField({ label, children, required = false, hint = "", invalid = false, as = "label" }) {
  const labelContent = (
    <span className={`admin-field-label ${required ? "is-required" : ""} ${invalid ? "is-invalid" : ""}`}>
      <span>{label}</span>
      {hint ? (
        <span
          aria-hidden="true"
          className="admin-field-help"
          title={hint}
        >
          ?
        </span>
      ) : null}
    </span>
  );
  if (as === "fieldset") {
    return (
      <fieldset className={`admin-field admin-fieldset ${invalid ? "is-invalid" : ""}`}>
        <legend>{labelContent}</legend>
        {children}
      </fieldset>
    );
  }
  return (
    <label className={`admin-field ${invalid ? "is-invalid" : ""}`}>
      {labelContent}
      {children}
    </label>
  );
}
