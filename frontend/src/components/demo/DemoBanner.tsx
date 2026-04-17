"use client";

import { FlaskConical, Sparkles } from "lucide-react";

export function DemoBanner() {
  return (
    <div className="sticky top-3 z-30 rounded-2xl border border-[var(--border)] bg-[var(--surface-card)]/92 px-4 py-3 shadow-[var(--shadow-panel)] backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--surface-card-soft)] text-[var(--text-2)]">
            <FlaskConical className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
              Demo mode
            </p>
            <p className="mt-1 text-[13px] leading-6 text-[var(--text-2)]">
              This walkthrough simulates payout confirmations and tax artifacts so judges can review the full end-to-end RailFi flow without waiting on live settlement rails.
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-card-soft)] px-3 py-1.5 text-[11px] font-[var(--font-mono)] text-[var(--text-2)]">
          <Sparkles className="h-3.5 w-3.5" />
          Sandbox settlement path
        </div>
      </div>
    </div>
  );
}
