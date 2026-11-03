import React from "react";
import { calculateLeadTime, type ReviewLeadTimes } from "@/lib/lead-time-calculation";

export function CalculatedLeadTime({ times }: { times: ReviewLeadTimes }) {
  const total = calculateLeadTime(times);
  const loading = Object.values(times).some((time) => time.loading);
  const error = Object.values(times).some((time) => time.error);
  const rows = [
    ["Design Time (weeks)", times.design, "text-design-time"],
    ["Procurement Time (weeks)", times.procurement, "text-procurement-time"],
    ["Assembly Time (weeks)", times.assembly, "text-assembly-time"],
  ] as const;

  return (
    <section className="border-t-2 border-slate-200 pt-4 space-y-2" aria-labelledby="calculated-lead-time-heading"
      data-testid="price-calculator-lead-time">
      <h3 id="calculated-lead-time-heading" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Calculated Lead Time
      </h3>
      {rows.map(([label, time, testId]) => (
        <div key={testId} className="flex items-center justify-between gap-3 text-sm" data-testid={testId}>
          <span className="text-slate-600">{label}</span>
          <span className={`text-right tabular-nums ${time.error ? "text-red-600" : "text-slate-900"}`}>
            {time.loading ? "Loading…" : time.error ? "Could not load"
              : time.value?.trim() ? `${time.value} weeks` : "Not recorded"}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 text-sm font-semibold"
        data-testid="text-calculated-lead-time">
        <span>Total Lead Time (weeks)</span>
        <span className="text-right tabular-nums">
          {loading ? "Loading…" : total ? `${total.totalWeeks} weeks` : "Not available"}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        {total
          ? `Design + Procurement + Assembly. Generate Quote starts at ${total.roundedWeeks} weeks, rounded up to a whole week.`
          : error ? "Could not load review lead times."
            : loading ? "Loading review lead times…"
              : "All three lead times must be recorded as numeric weeks to calculate the total."}
      </p>
    </section>
  );
}
