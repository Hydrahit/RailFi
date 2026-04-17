import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ExternalLink } from "lucide-react";
import { ProgramIdBadge } from "@/components/ProgramIdBadge";
import { explorerTx, PROGRAM_ID } from "@/lib/solana";
import { getServerHeliusApiKey } from "@/lib/server-env";
import { getAnalyticsSnapshot, type AnalyticsSnapshot } from "@/lib/analytics";

export const revalidate = 60;

interface HeliusTransaction {
  signature: string;
  timestamp: number;
  description?: string;
  tokenTransfers?: Array<{
    mint?: string;
    tokenAmount?: number;
  }>;
}

interface PublicTransactionRow {
  signature: string;
  timestamp: number;
  description: string;
  usdcAmount: number;
}

function getAnalyticsUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not configured for the public stats page.");
  }

  return `${appUrl.replace(/\/$/, "")}/api/analytics`;
}

async function getPublicAnalytics(): Promise<AnalyticsSnapshot> {
  try {
    const response = await fetch(getAnalyticsUrl(), {
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      throw new Error(`Analytics API failed with status ${response.status}.`);
    }

    return (await response.json()) as AnalyticsSnapshot;
  } catch (error) {
    console.warn("[stats] Falling back to direct analytics snapshot:", error);
    return getAnalyticsSnapshot();
  }
}

async function getRecentProgramTransactions(): Promise<PublicTransactionRow[]> {
  const apiKey = getServerHeliusApiKey();
  const url = new URL(`https://api.helius.xyz/v0/addresses/${PROGRAM_ID.toBase58()}/transactions`);
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("type", "ANY");
  url.searchParams.set("limit", "10");

  const response = await fetch(url.toString(), {
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`Helius transaction feed failed with status ${response.status}.`);
  }

  const transactions = (await response.json()) as HeliusTransaction[];
  return transactions.map((transaction) => ({
    signature: transaction.signature,
    timestamp: transaction.timestamp,
    description: transaction.description ?? "RailFi program interaction",
    usdcAmount: (transaction.tokenTransfers ?? []).reduce(
      (sum, transfer) => sum + (transfer.tokenAmount ?? 0),
      0,
    ),
  }));
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function StatsPage() {
  const [analytics, recentTransactions] = await Promise.all([
    getPublicAnalytics(),
    getRecentProgramTransactions().catch(() => [] as PublicTransactionRow[]),
  ]);

  return (
    <main className="mesh-bg min-h-screen px-3 py-4 sm:px-6 lg:px-8">
      <div className="app-shell mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl flex-col rounded-3xl p-4 sm:p-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-center gap-3">
            <Link href="/" className="btn-ghost rounded-lg">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
            <div>
              <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                Public stats
              </p>
              <h1 className="mt-1 font-[var(--font-syne)] text-2xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
                Live protocol activity on Solana Devnet.
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ProgramIdBadge showFull={true} />
            <a
              href={`https://explorer.solana.com/address/${analytics.programId}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-card-soft)] px-4 py-2 text-[11px] font-[var(--font-mono)] text-[var(--text-2)] transition hover:text-[var(--text-1)]"
            >
              View on Explorer
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        <section className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
            <p className="mt-2 text-[12px] text-[var(--text-2)]">
              7 day activity: {analytics.last7dTransactions}
            </p>
          </article>
        </section>

        <section className="section-shell content-card mt-6 rounded-2xl p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                Recent transactions
              </p>
              <h2 className="mt-2 font-[var(--font-syne)] text-2xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
                Latest on-chain settlement activity
              </h2>
              <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--text-2)]">
                High-level protocol stats come from the public analytics API, while this table is
                fetched directly from Helius for fresh program activity and explorer verification.
              </p>
            </div>

            <div className="text-[11px] font-[var(--font-mono)] text-[var(--text-3)]">
              Refreshed every 60 seconds
            </div>
          </div>

          {recentTransactions.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-black/10 bg-[var(--surface-muted)] px-4 py-5 text-[13px] text-[var(--text-2)]">
              Recent transaction data is temporarily unavailable.
            </div>
          ) : (
            <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--border)]">
              <div className="hidden grid-cols-[1.2fr_0.7fr_0.45fr_0.4fr] gap-4 border-b border-[var(--border)] bg-[var(--surface-card-soft)] px-5 py-3 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.2em] text-[var(--text-3)] md:grid">
                <span>Transaction</span>
                <span>Time</span>
                <span>USDC</span>
                <span>Proof</span>
              </div>

              <div className="divide-y divide-[var(--border)]">
                {recentTransactions.map((transaction) => (
                  <div
                    key={transaction.signature}
                    className="grid gap-3 px-4 py-4 md:grid-cols-[1.2fr_0.7fr_0.45fr_0.4fr] md:items-center md:gap-4 md:px-5"
                  >
                    <div className="min-w-0">
                      <p className="font-[var(--font-syne)] text-[17px] font-[700] tracking-[-0.03em] text-[var(--text-1)]">
                        {transaction.description}
                      </p>
                      <p className="mt-1 break-all text-[12px] text-[var(--text-2)]">
                        {transaction.signature}
                      </p>
                    </div>

                    <div className="text-[12px] text-[var(--text-2)]">
                      {formatDateTime(transaction.timestamp)}
                    </div>

                    <div className="tabular-nums font-[var(--font-syne)] text-[16px] font-[700] text-[var(--text-1)]">
                      {transaction.usdcAmount.toFixed(2)} USDC
                    </div>

                    <div>
                      <a
                        href={explorerTx(transaction.signature)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-[var(--font-mono)] text-[var(--accent-green)] hover:underline"
                      >
                        Explorer
                        <ArrowUpRight className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
