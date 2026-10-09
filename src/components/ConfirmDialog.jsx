import React, { useEffect, useState } from "react";
import { subscribeConfirm } from "./confirmBus";

// Mounted once at the app root. Shows the question askConfirm() asked.
export function ConfirmDialog() {
  const [request, setRequest] = useState(null);
  useEffect(() => subscribeConfirm(setRequest), []);

  if (!request) return null;

  function answer(ok) {
    request.resolve(ok);
    setRequest(null);
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4"
      onClick={() => answer(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl p-5 max-w-sm w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-slate-800">{request.message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => answer(false)}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => answer(true)}
            className="px-3 py-1.5 text-sm rounded-lg bg-[#1e3a5f] text-white hover:bg-[#162c48]"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
