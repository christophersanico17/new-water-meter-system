import React from "react";
import { getConsumptionStatus } from "../data";

export function ConsumptionStatusBanner({ me }) {
  const status = getConsumptionStatus(me);
  const styles = {
    good: { wrap: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500", text: "text-emerald-800", label: "text-emerald-700" },
    warn: { wrap: "bg-amber-50 border-amber-200", dot: "bg-amber-500", text: "text-amber-800", label: "text-amber-700" },
    bad: { wrap: "bg-rose-50 border-rose-200", dot: "bg-rose-500", text: "text-rose-800", label: "text-rose-700" },
  }[status.tone];

  return (
    <div className={`rounded-lg border ${styles.wrap} px-4 py-3 mb-5 flex items-start gap-3`}>
      <div className={`w-7 h-7 rounded-full ${styles.dot} shrink-0`} />
      <div>
        <div className={`text-[13px] font-bold ${styles.label}`}>{status.label}</div>
        <div className={`text-xs ${styles.text} mt-0.5`}>{status.message}</div>
      </div>
    </div>
  );
}
