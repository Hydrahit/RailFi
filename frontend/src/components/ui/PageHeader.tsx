"use client";

import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "surface-card content-card animate-in flex flex-col gap-4 rounded-2xl p-5 sm:p-6 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-2 text-[11px] font-[var(--font-mono)] uppercase tracking-[0.24em] text-[var(--text-3)]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-3xl font-[var(--font-syne)] font-[800] tracking-[-0.05em] sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-[14px] leading-6 text-[var(--text-2)]">
            {description}
          </p>
        ) : null}
        {meta ? <div className="mt-4 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 self-start">{actions}</div> : null}
    </div>
  );
}
