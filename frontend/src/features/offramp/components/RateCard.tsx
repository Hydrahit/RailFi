"use client";

import type { RateTier } from "@/types/railpay";
import { cn } from "@/lib/utils";
import { useUsdInrReference } from "@/hooks/useUsdInrReference";
import { StatusPill } from "@/components/ui/StatusPill";

const RATE_TIERS: RateTier[] = [
  { label: "Micro", minUsdc: 0, maxUsdc: 10, feePercent: 1.5 },
  { label: "Standard", minUsdc: 10, maxUsdc: 100, feePercent: 1 },
  { label: "Pro", minUsdc: 100, maxUsdc: 1000, feePercent: 0.75, badge: "Priority" },
  { label: "Whale", minUsdc: 1000, maxUsdc: null, feePercent: 0.5, badge: "Concierge" },
];

interface RateCardProps {
  amount?: number;
}

export function RateCard({ amount = 0 }: RateCardProps) {
  const usdInrReference = useUsdInrReference();
  const activeTier = RATE_TIERS.findIndex(
    (tier) => amount >= tier.minUsdc && (tier.maxUsdc === null || amount < tier.maxUsdc),
  );

  return (
    <div className="section-shell p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Rate reference
          </p>
          <h3 className="mt-2 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
            Pricing tiers for the current flow
          </h3>
        </div>
        <StatusPill tone="success">
          <span className="h-2 w-2 rounded-full bg-[var(--green)] pulse-dot" />
          {usdInrReference === null
            ? "Live FX reference"
            : `Rs ${usdInrReference.toFixed(2)} / USDC reference`}
        </StatusPill>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {RATE_TIERS.map((tier, index) => {
          const active = index === activeTier;

          return (
            <article
              key={tier.label}
              className={cn(
                "rounded-[24px] border p-4 transition-all active:scale-[0.99]",
                active
                  ? "border-[var(--green-border)] bg-[var(--mint-soft)] shadow-[0_16px_34px_rgba(20,241,149,0.08)]"
                  : "border-[var(--border)] bg-[var(--surface-card-soft)]",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--text-3)]">
                    {tier.label}
                  </p>
                  <div className="mt-2 text-xl font-[var(--font-syne)] font-[800] tracking-[-0.04em]">
                    {tier.feePercent}% fee
                  </div>
                </div>
                {tier.badge ? <StatusPill tone={active ? "dark" : "neutral"}>{tier.badge}</StatusPill> : null}
              </div>
              <p className="mt-3 text-[12px] text-[var(--text-2)]">
                {tier.minUsdc}-{tier.maxUsdc ?? "Infinity"} USDC payout range
              </p>
            </article>
          );
        })}
      </div>

      <p className="mt-4 text-[12px] text-[var(--text-2)]">
        Reference pricing for the Devnet demo. Live production payout logic still depends on the
        on-chain oracle lock and backend settlement path.
      </p>
    </div>
  );
}
