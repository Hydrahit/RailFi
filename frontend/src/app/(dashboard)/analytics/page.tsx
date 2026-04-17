import Link from "next/link";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { getAnalyticsSnapshot } from "@/lib/analytics";
import { explorerTx } from "@/lib/solana";

export const revalidate = 60;

function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function AnalyticsPage() {
  const analytics = await getAnalyticsSnapshot();

  return (
    <div className="space-y-6">
      <section className="metric-panel-dark dark-card overflow-hidden rounded-3xl p-6 sm:p-7">
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
              Public analytics
            </p>
            <h1 className="text-heavy-primary mt-3 font-[var(--font-syne)] text-4xl font-[800] tracking-[-0.06em]">
              Live protocol footprint, straight from chain history.
            </h1>
            <p className="text-heavy-secondary mt-3 max-w-2xl text-[14px] leading-7">
              All metrics read directly from the Solana blockchain via Helius.
            </p>
          </div>

          <div className="surface-heavy-elevated rounded-2xl p-5">
            <p className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
              Data source
            </p>
            <p className="text-heavy-primary mt-3 text-[14px] leading-7">
              Program: {analytics.programId.slice(0, 8)}...{analytics.programId.slice(-8)}
            </p>
            <p className="text-heavy-secondary mt-2 text-[12px]">
              Refreshed every 60 seconds to keep demos stable without hammering Helius.
            </p>
            {analytics.dataTruncated ? (
              <p className="mt-2 text-[12px] text-[var(--text-2)]">{analytics.dataNote}</p>
            ) : null}
            {analytics.degraded && analytics.error ? (
              <p className="mt-3 text-[12px] text-[#F8D682]">{analytics.error}</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <article className="metric-panel content-card rounded-2xl p-5">
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Total volume
          </p>
          <p className="mt-3 tabular-nums font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
            {analytics.totalVolumeUsdc.toFixed(2)} USDC
          </p>
        </article>

        <article className="metric-panel content-card rounded-2xl p-5">
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Total transactions
          </p>
          <p className="mt-3 tabular-nums font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
            {analytics.totalTransactions}
          </p>
        </article>

        <article className="metric-panel-dark dark-card rounded-2xl p-5">
          <p className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
            Unique wallets
          </p>
          <p className="text-heavy-primary mt-3 tabular-nums font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em]">
            {analytics.totalUniqueWallets}
          </p>
        </article>

        <article className="metric-panel content-card rounded-2xl p-5">
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            30 day activity
          </p>
          <p className="mt-3 tabular-nums font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
            {analytics.last30dTransactions}
          </p>
          <p className="mt-2 text-[12px] text-[var(--text-2)]">7 day activity: {analytics.last7dTransactions}</p>
        </article>
      </section>

      {analytics.dataTruncated ? (
        <p className="px-1 text-[12px] text-[var(--text-2)]">{analytics.dataNote}</p>
      ) : null}

      <section className="section-shell content-card rounded-2xl p-5 sm:p-6">
        <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
          Transparent by design
        </p>
        <p className="mt-3 text-[14px] leading-7 text-[var(--text-2)]">
          All figures are read directly from the Solana blockchain via Helius Enhanced Transactions
          API.
          <br />
          No self-reported numbers. Every transaction is independently verifiable on-chain.
        </p>
        <a
          href={`https://explorer.solana.com/address/${analytics.programId}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 text-[12px] text-[var(--accent-green)] hover:underline"
        >
          Verify program on Solana Explorer
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </section>

      <section className="section-shell content-card rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
              Recent transactions
            </p>
            <h2 className="mt-2 font-[var(--font-syne)] text-2xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
              Latest program activity
            </h2>
          </div>
          <Link
            href={`https://explorer.solana.com/address/${analytics.programId}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost rounded-lg"
          >
            View program
            <ExternalLink className="h-4 w-4" />
          </Link>
        </div>

        {analytics.recentTransactions.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-black/10 bg-[var(--surface-muted)] px-4 py-5 text-[13px] text-[var(--text-2)]">
            {analytics.degraded
              ? "Analytics are temporarily unavailable, but the page recovered gracefully."
              : "No program transactions have been indexed yet."}
          </div>
        ) : (
          <div className="mt-5 divide-y divide-black/8">
            {analytics.recentTransactions.map((transaction) => (
              <div key={transaction.signature} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-[var(--font-syne)] text-[18px] font-[700] tracking-[-0.04em] text-[var(--text-1)]">
                    {transaction.description}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-2)]">
                    <span>{formatDateTime(transaction.timestamp)}</span>
                    <span aria-hidden="true">/</span>
                    <span>{transaction.wallet.slice(0, 6)}...{transaction.wallet.slice(-6)}</span>
                  </div>
                </div>

                <div className="text-left sm:text-right">
                  <p className="tabular-nums font-[var(--font-syne)] text-[22px] font-[800] tracking-[-0.05em] text-[var(--text-1)]">
                    {transaction.usdcAmount.toFixed(2)} USDC
                  </p>
                  <a
                    href={explorerTx(transaction.signature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-[var(--font-mono)] text-[var(--accent-green)] hover:underline"
                  >
                    Explorer proof
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
