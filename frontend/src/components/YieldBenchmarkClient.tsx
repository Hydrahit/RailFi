"use client";

import { useEffect, useState } from "react";
import { Coins, Landmark, PiggyBank, ShieldCheck } from "lucide-react";
import type { YieldSnapshot } from "@/lib/yield";

function formatUsdc(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatInr(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function YieldBenchmarkClient() {
  const [snapshot, setSnapshot] = useState<YieldSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await fetch("/api/yield", {
          method: "GET",
          cache: "force-cache",
        });
        const payload = (await response.json()) as YieldSnapshot | { error?: string };

        if (!response.ok || !("generatedAt" in payload)) {
          throw new Error(
            "error" in payload
              ? payload.error ?? "Failed to load the yield benchmark snapshot."
              : "Failed to load the yield benchmark snapshot.",
          );
        }

        if (!cancelled) {
          setSnapshot(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Failed to load the yield benchmark snapshot.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <section className="metric-panel-dark dark-card overflow-hidden rounded-3xl p-6 sm:p-7">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="action-pill-dark w-fit">
              <Coins className="h-4 w-4" />
              Yield benchmark
            </div>
            <div>
              <p className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.24em]">
                Kamino integration
              </p>
              <h1 className="text-heavy-primary mt-3 text-4xl font-[var(--font-syne)] font-[800] tracking-[-0.07em] sm:text-5xl">
                Yield benchmark for RailFi vault TVL.
              </h1>
              <p className="text-heavy-secondary mt-4 max-w-2xl text-[14px] leading-7">
                Yield benchmark - RailFi vault TVL benchmarked against Kamino Finance USDC
                lending market. Live vault yield integration is on the mainnet roadmap.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="surface-heavy-elevated rounded-2xl p-4">
              <p className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
                Yield mode
              </p>
              <div className="text-heavy-primary mt-3 font-[var(--font-syne)] text-2xl font-[800] tracking-[-0.05em]">
                {isLoading ? "Loading..." : snapshot?.mode === "benchmark_only" ? "Benchmark only" : "Unavailable"}
              </div>
              <p className="text-heavy-secondary mt-2 text-[12px]">
                {snapshot?.kaminoEnabled
                  ? "kamino_enabled is on, but on-chain Kamino CPIs remain stubbed until a compile-safe integration lands."
                  : "kamino_enabled is off on Devnet, so vault funds remain in the standard escrow ATA path."}
              </p>
            </div>

            <div className="surface-heavy-elevated rounded-2xl p-4">
              <p className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
                Data source
              </p>
              <div className="text-heavy-primary mt-3 font-[var(--font-syne)] text-2xl font-[800] tracking-[-0.05em]">
                {isLoading ? "Loading..." : snapshot?.source ?? "Pending"}
              </div>
              <p className="text-heavy-secondary mt-2 text-[12px]">
                RailFi TVL is sourced from on-chain vault reserve ATAs. APY is sourced from the
                Kamino Mainnet USDC market.
              </p>
            </div>
          </div>
        </div>
      </section>

      {loadError ? (
        <section className="section-shell rounded-2xl border border-[color:var(--warning-fg)]/20 bg-[var(--warning-bg)]/55 p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning-fg)]" />
            <div>
              <p className="text-[13px] font-[var(--font-syne)] font-[700] text-[var(--warning-fg)]">
                Yield benchmark unavailable.
              </p>
              <p className="mt-1 text-[12px] text-[var(--warning-fg)]/90">{loadError}</p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-4">
        <article className="metric-panel content-card rounded-2xl p-5">
          <div className="flex items-center gap-2 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            <Landmark className="h-3.5 w-3.5" />
            Live Kamino USDC APY
          </div>
          <div className="mt-3 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
            {snapshot ? formatPercent(snapshot.apyPercent) : "--"}
          </div>
          <p className="mt-2 text-[12px] text-[var(--text-2)]">
            {snapshot ? `${snapshot.apyBps} bps benchmark supply APY` : "Waiting for benchmark feed"}
          </p>
        </article>

        <article className="metric-panel content-card rounded-2xl p-5">
          <div className="flex items-center gap-2 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            <PiggyBank className="h-3.5 w-3.5" />
            Total idle TVL
          </div>
          <div className="mt-3 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
            {snapshot ? `${formatUsdc(snapshot.totalIdleTvlUsdc)} USDC` : "--"}
          </div>
          <p className="mt-2 text-[12px] text-[var(--text-2)]">
            Summed from current RailFi vault reserve ATAs on-chain
          </p>
        </article>

        <article className="metric-panel content-card rounded-2xl p-5">
          <div className="flex items-center gap-2 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            <Coins className="h-3.5 w-3.5" />
            Projected monthly yield
          </div>
          <div className="mt-3 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
            {snapshot ? `${formatUsdc(snapshot.projectedMonthlyYieldUsdc)} USDC` : "--"}
          </div>
          <p className="mt-2 text-[12px] text-[var(--text-2)]">
            Benchmark only, based on current Mainnet APY and current idle float
          </p>
        </article>

        <article className="metric-panel-dark dark-card rounded-2xl p-5">
          <div className="text-heavy-muted flex items-center gap-2 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
            <ShieldCheck className="h-3.5 w-3.5" />
            Projected monthly protocol yield
          </div>
          <div className="text-heavy-primary mt-3 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em]">
            {snapshot ? formatInr(snapshot.projectedMonthlyYieldInr) : "--"}
          </div>
          <p className="text-heavy-secondary mt-2 text-[12px]">
            INR estimate uses a benchmark conversion of{" "}
            {snapshot ? snapshot.benchmarkUsdInr.toFixed(2) : "--"} INR per USD-equivalent
            USDC yield.
          </p>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <article className="section-shell rounded-2xl p-5">
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Reviewer note
          </p>
          <h2 className="mt-3 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em] text-[var(--text-1)]">
            The safe toggle protects Devnet demos from Kamino pool exhaustion.
          </h2>
          <p className="mt-3 text-[14px] leading-7 text-[var(--text-2)]">
            Kamino&apos;s Devnet pools can run dry, so RailFi keeps the canonical SPL vault path live
            unless `kamino_enabled` is explicitly turned on after a compile-safe CPI path is proven.
            That preserves settlement reliability while still showing the DeFi composability story
            in code and in business-model math.
          </p>
        </article>

        <article className="section-shell rounded-2xl p-5">
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Snapshot metadata
          </p>
          <div className="mt-4 space-y-3 text-[13px] text-[var(--text-2)]">
            <div className="flex items-center justify-between gap-4">
              <span>Kamino toggle</span>
              <span className="font-[var(--font-mono)] text-[var(--text-1)]">
                {snapshot?.kaminoEnabled ? "enabled" : "disabled"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Mode</span>
              <span className="font-[var(--font-mono)] text-[var(--text-1)]">
                {snapshot?.mode ?? "benchmark_only"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Generated</span>
              <span className="font-[var(--font-mono)] text-[var(--text-1)]">
                {snapshot ? new Date(snapshot.generatedAt).toLocaleString("en-IN") : "Pending"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Benchmark source</span>
              <span className="font-[var(--font-mono)] text-[var(--text-1)]">
                {snapshot?.source ?? "Unavailable"}
              </span>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
