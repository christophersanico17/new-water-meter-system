import React, { useEffect, useRef, useState } from "react";
import { subscribeConfirm } from "./confirmBus";

// Mounted once at the app root. Shows the question askConfirm() asked.
export function ConfirmDialog() {
  const [request, setRequest] = useState(null);
  const okRef = useRef(null);
  useEffect(() => subscribeConfirm(setRequest), []);

  // Escape cancels, Enter confirms, and OK gets focus so Enter works right away.
  useEffect(() => {
    if (!request) return;
    okRef.current?.focus();
    function onKey(e) {
      if (e.key === "Escape") answer(false);
      if (e.key === "Enter") answer(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!request) return null;

  function answer(ok) {
    request.resolve(ok);
    setRequest(null);
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center z-[60] p-4"
      onClick={() => answer(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-900">
          Please confirm
        </h2>
        <p className="mt-1 text-sm text-slate-600 break-words">{request.message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => answer(false)}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            ref={okRef}
            onClick={() => answer(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-[#1e3a5f] text-white hover:bg-[#162c48] focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
