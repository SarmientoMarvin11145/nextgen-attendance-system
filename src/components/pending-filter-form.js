"use client";

import { createContext, useContext, useRef, useState } from "react";

const FilterPendingContext = createContext(false);

export function PendingFilterSubmit({ children, pendingLabel, className }) {
  const pending = useContext(FilterPendingContext);

  return (
    <button className={className} type="submit" disabled={pending} aria-busy={pending || undefined}>
      {pending ? pendingLabel : children}
    </button>
  );
}

export default function PendingFilterForm({ action, className, children }) {
  const [pending, setPending] = useState(false);
  const submittedRef = useRef(false);

  function handleSubmit(event) {
    if (submittedRef.current) {
      event.preventDefault();
      return;
    }

    submittedRef.current = true;
    setPending(true);
  }

  return (
    <form className={className} action={action} method="get" onSubmit={handleSubmit} aria-busy={pending || undefined}>
      <FilterPendingContext.Provider value={pending}>{children}</FilterPendingContext.Provider>
    </form>
  );
}