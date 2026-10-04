"use client";

import { useFormStatus } from "react-dom";

export default function PendingActionButton({ children, pendingLabel, className, ...props }) {
  const { pending } = useFormStatus();

  return (
    <button
      {...props}
      className={className}
      type="submit"
      disabled={pending || props.disabled}
      aria-busy={pending || undefined}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}