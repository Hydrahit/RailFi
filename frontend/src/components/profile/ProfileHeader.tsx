"use client";

import { useMemo } from "react";
import { Copy, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/useToast";
import type { ProfileSummary } from "@/types/offramp";

export function ProfileHeader({ profile }: { profile: ProfileSummary }) {
  const { showToast } = useToast();
  const avatarAccent = useMemo(() => `#${profile.avatarSeed.slice(0, 6)}`, [profile.avatarSeed]);

  return (
    <section className="metric-panel-dark rounded-3xl p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-3xl text-lg font-[var(--font-syne)] font-[800] text-white"
            style={{ background: `linear-gradient(145deg, ${avatarAccent}, #111111)` }}
          >
            {profile.shortAddress.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-heavy-muted text-[11px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
              Profile
            </p>
            <h1 className="text-heavy-primary mt-2 text-3xl font-[var(--font-syne)] font-[800] tracking-[-0.06em]">
              {profile.shortAddress}
            </h1>
            <p className="text-heavy-secondary mt-2 text-[13px] leading-6">
              Member since {profile.memberSince ? new Date(profile.memberSince).toLocaleDateString("en-IN") : "today"}.
              Lifetime volume Rs {profile.totalOfframpedInr.toLocaleString("en-IN")}.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {profile.googleLinked ? (
            <div className="action-pill-dark text-[11px] font-[var(--font-mono)]">
              <ShieldCheck className="h-3.5 w-3.5" />
              Identity verified
            </div>
          ) : null}
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(profile.walletAddress);
              showToast("Wallet address copied", "success");
            }}
            className="action-pill-dark text-[11px] font-[var(--font-mono)]"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy wallet
          </button>
        </div>
      </div>
    </section>
  );
}
