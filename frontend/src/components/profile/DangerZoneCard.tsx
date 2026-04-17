"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/useToast";

export function DangerZoneCard() {
  const router = useRouter();
  const { showToast } = useToast();

  return (
    <section className="section-shell rounded-3xl border border-[color:var(--danger-fg)]/20 bg-[var(--danger-bg)]/35 p-6">
      <p className="text-[11px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--danger-fg)]">
        Danger zone
      </p>
      <h2 className="mt-2 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
        Disconnect current wallet session
      </h2>
      <p className="mt-2 text-[13px] leading-6 text-[var(--danger-fg)]/85">
        Clears the current browser-side wallet session and returns you to the landing page.
      </p>
      <button
        type="button"
        className="btn-primary mt-5 w-auto"
        onClick={async () => {
          await fetch("/api/auth/wallet/session", { method: "DELETE" });
          showToast("Wallet session cleared", "success");
          router.push("/");
          router.refresh();
        }}
      >
        Disconnect wallet
      </button>
    </section>
  );
}
