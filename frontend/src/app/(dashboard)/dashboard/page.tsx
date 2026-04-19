"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ExternalLink, History, ShieldCheck, Sparkles } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMinimumLoading } from "@/hooks/useMinimumLoading";
import { useRailpayContext } from "@/providers/RailpayProvider";
import { explorerAddr } from "@/lib/solana";
import { shortAddress } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardPageSkeleton } from "@/components/ui/AppSkeletons";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { StatusPill } from "@/components/ui/StatusPill";
import { useUsdInrReference } from "@/hooks/useUsdInrReference";

const CircuitBreakerStatus = dynamic(
  () => import("@/components/CircuitBreakerStatus").then((mod) => mod.CircuitBreakerStatus),
  {
    ssr: false,
    loading: () => <div className="section-shell min-h-[240px] animate-pulse rounded-2xl bg-[var(--surface-card)]" />,
  },
);

const WalletDashboard = dynamic(
  () => import("@/components/WalletDashboard").then((mod) => mod.WalletDashboard),
  {
    ssr: false,
    loading: () => <div className="section-shell min-h-[420px] animate-pulse rounded-2xl bg-[var(--surface-card)]" />,
  },
);

const ReferralDashboard = dynamic(
  () => import("@/components/ReferralDashboard").then((mod) => mod.ReferralDashboard),
  {
    ssr: false,
    loading: () => <div className="section-shell min-h-[220px] animate-pulse rounded-2xl bg-[var(--surface-card)]" />,
  },
);

export default function DashboardPage() {
  const { publicKey } = useWallet();
  const { balances, vault, refreshBalances, refreshVault, isBootstrapping } =
    useRailpayContext();
  const [animationSeed, setAnimationSeed] = useState(0);
  const usdInrReference = useUsdInrReference();
  const showBootSkeleton = useMinimumLoading(isBootstrapping, 300);

  if (showBootSkeleton) {
    return <DashboardPageSkeleton />;
  }

  const walletInrEstimate =
    typeof usdInrReference === "number" ? balances.usdc * usdInrReference : null;
  const stats = [
    {
      label: "Vault available",
      value: vault?.availableUsdc ?? 0,
      suffix: " USDC",
      meta: "Ready to settle",
      dark: false,
    },
    {
      label: "Escrow reserve",
      value: vault?.escrowUsdc ?? 0,
      suffix: " USDC",
      meta: "Protected on-chain",
      dark: true,
    },
    {
      label: "Total offramped",
      value: vault?.totalOfframped ?? 0,
      suffix: " USDC",
      meta: "Lifetime payout volume",
      dark: false,
    },
    {
      label: "Receipts",
      value: vault?.receiptCount ?? 0,
      decimals: 0,
      meta: "Bubblegum cNFT proofs",
      dark: false,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="Wallet-grade settlement control."
        description="Monitor vault readiness, payout safety, and receipt generation from one bento control surface."
        meta={
          <>
            <StatusPill tone="success">
              <span className="status-dot" />
              Devnet active
            </StatusPill>
            {publicKey ? (
              <a
                href={explorerAddr(publicKey)}
                target="_blank"
                rel="noopener noreferrer"
                className="action-pill text-[11px] font-[var(--font-mono)]"
              >
                {shortAddress(publicKey.toString(), 6)}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </>
        }
        actions={
          <RefreshButton
            onRefresh={() => Promise.all([refreshBalances(), refreshVault()]).then(() => undefined)}
            onSuccess={() => setAnimationSeed((current) => current + 1)}
          />
        }
      />

      <section className="surface-hero content-card animate-in overflow-hidden rounded-3xl p-5 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <StatusPill tone="neutral">
              <Sparkles className="h-3.5 w-3.5" />
              Premium settlement view
            </StatusPill>
            <div>
              <p className="text-[11px] font-[var(--font-mono)] uppercase tracking-[0.24em] text-[var(--text-3)]">
                Wallet balance
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="font-[var(--font-syne)] text-5xl font-[800] tracking-[-0.08em] sm:text-6xl">
                  {balances.isLoading ? (
                    <span className="shimmer inline-block h-14 w-52 rounded-xl" />
                  ) : (
                    <AnimatedNumber value={balances.usdc} suffix="" animateKey={animationSeed} />
                  )}
                </div>
                <span className="pb-2 text-sm font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--text-3)]">
                  USDC
                </span>
              </div>
              <p className="mt-3 max-w-xl text-[14px] leading-6 text-[var(--text-2)]">
                Approx.{" "}
                {walletInrEstimate === null ? (
                  "live INR estimate unavailable"
                ) : (
                  <AnimatedNumber
                    value={walletInrEstimate}
                    animateKey={animationSeed}
                    formatValue={(value) =>
                      new Intl.NumberFormat("en-IN", {
                        style: "currency",
                        currency: "INR",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(value)
                    }
                  />
                )}{" "}
                at the current reference rate. Vault,
                oracle, and circuit-breaker posture stays visible below for confident settlement actions.
              </p>
            </div>
          </div>

          <div className="metric-panel-dark dark-card animate-in flex flex-col justify-between rounded-2xl p-6" style={{ animationDelay: "80ms" }}>
            <div>
              <div className="flex items-center justify-between">
                <p className="text-heavy-muted text-[11px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
                  Safety posture
                </p>
                <div className="surface-heavy-elevated text-heavy-secondary rounded-full p-2">
                  <ShieldCheck className="h-4 w-4" />
                </div>
              </div>
              <h2 className="text-heavy-primary mt-4 text-3xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
                Effortless by feel. Defensive by design.
              </h2>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Link href="/transfer" className="action-pill-contrast justify-between active:scale-[0.99]">
                Trigger offramp
                <ArrowUpRight className="h-4 w-4" />
              </Link>
              <Link
                href="/history"
                className="action-pill-dark justify-between active:scale-[0.99]"
              >
                View history
                <History className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <article
            key={stat.label}
            className={stat.dark ? "metric-panel-dark dark-card animate-in rounded-2xl p-5" : "metric-panel content-card animate-in rounded-2xl p-5"}
            style={{ animationDelay: `${160 + stats.indexOf(stat) * 80}ms` }}
          >
            <p
              className={`text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] ${
                stat.dark ? "text-heavy-muted" : "text-[var(--text-3)]"
              }`}
            >
              {stat.label}
            </p>
            <div
              className={`mt-3 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] ${
                stat.dark ? "text-heavy-primary" : "text-[var(--text-1)]"
              }`}
            >
              {balances.isLoading ? (
                <span className="shimmer inline-block h-9 w-28 rounded-xl" />
              ) : (
                <AnimatedNumber
                  value={stat.value}
                  decimals={stat.decimals ?? 2}
                  suffix={stat.suffix ?? ""}
                  animateKey={`${animationSeed}-${stat.label}`}
                />
              )}
            </div>
            <p className={`mt-2 text-[12px] ${stat.dark ? "text-heavy-secondary" : "text-[var(--text-2)]"}`}>
              {stat.meta}
            </p>
          </article>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <CircuitBreakerStatus />
        <WalletDashboard />
      </div>

      <ReferralDashboard />
    </div>
  );
}
