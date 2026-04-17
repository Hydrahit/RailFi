"use client";

import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "dark" | "darkSoft";

const TONE_STYLES: Record<Tone, string> = {
  neutral: "bg-[var(--surface-card-soft)] text-[var(--text-secondary)] border border-[var(--border)]",
  success: "bg-[var(--accent-mint)] text-[#0f3a2f] border border-transparent",
  warning: "bg-[var(--accent-peach)] text-[#92400e] border border-transparent",
  danger: "bg-[var(--accent-peach)] text-[#9a3412] border border-transparent",
  dark: "bg-[var(--surface-heavy)] text-[var(--text-inverted)] border border-black/40",
  darkSoft: "bg-[var(--surface-heavy-soft)] text-[var(--text-heavy-primary)] border border-[var(--border-heavy)]",
};

export function StatusPill({
  children,
  tone = "neutral",
  className,
  ...props
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-[var(--font-syne)] font-[650] transition-transform duration-200",
        TONE_STYLES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
