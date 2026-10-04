export default function FormFeedback({ state }) {
  if (!state?.message) {
    return null;
  }

  const isError = state.status === "error";

  return (
    <p className={`form-feedback ${isError ? "form-feedback-error" : "form-feedback-success"}`} role={isError ? "alert" : "status"}>
      {state.message}
    </p>
  );
}