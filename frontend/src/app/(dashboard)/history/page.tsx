"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Copy, ExternalLink } from "lucide-react";
import { useHistory } from "@/hooks/useHistory";
import { useMinimumLoading } from "@/hooks/useMinimumLoading";
import { useToast } from "@/hooks/useToast";
import { useRailpayContext } from "@/providers/RailpayProvider";
import { cn, formatInr, relativeTime } from "@/lib/utils";
import type { Transaction } from "@/types/railpay";
import { PageHeader } from "@/components/ui/PageHeader";
import { HistoryLedgerSkeleton, HistoryPageSkeleton } from "@/components/ui/AppSkeletons";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { StatusPill } from "@/components/ui/StatusPill";

export default function HistoryPage() {
  const { vault, vaultPda, isBootstrapping } = useRailpayContext();
  const { transactions, isLoading, error, refresh } = useHistory(vaultPda);
  const [openId, setOpenId] = useState<string | null>(null);
  const showLoading = useMinimumLoading(isLoading, 300);

  if (isBootstrapping) {
    return <HistoryPageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="History"
        title="A calmer ledger for every payout."
        description="Review real on-chain offramp activity, minted receipts, and explorer-linked settlement proof in a premium wallet-style timeline."
        meta={
          <>
            <StatusPill tone="success">{vault?.receiptCount ?? 0} receipts minted</StatusPill>
            <StatusPill>On-chain offramp settlements</StatusPill>
          </>
        }
        actions={
          <RefreshButton onRefresh={refresh} />
        }
      />

      {showLoading ? <HistoryLedgerSkeleton /> : null}

      {!showLoading && error ? (
        <div className="section-shell border border-[color:var(--danger-fg)]/15 bg-[var(--danger-bg)]/45 p-6">
          <p className="text-[13px] font-[var(--font-syne)] font-[700] text-[var(--danger-fg)]">
            History is temporarily unavailable
          </p>
          <p className="mt-1 text-[12px] text-[var(--danger-fg)]/80">{error}</p>
        </div>
      ) : null}

      {!showLoading && !error && transactions.length === 0 ? <EmptyHistoryState /> : null}

      {!showLoading && !error && transactions.length > 0 ? (
        <div className="space-y-3">
          {transactions.map((tx, index) => (
            <TxRow
              key={tx.id}
              tx={tx}
              index={index}
              isOpen={openId === tx.id}
              onToggle={() => setOpenId((current) => (current === tx.id ? null : tx.id))}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmptyHistoryState() {
  return (
    <div className="section-shell content-card empty-state p-10 text-center">
      <div className="empty-state-icon mx-auto flex h-16 w-16 items-center justify-center rounded-[24px] bg-[var(--bg-muted)] text-[#acacac] shadow-[0_16px_32px_rgba(33,28,19,0.08)]">
        <ArrowUpRight className="h-6 w-6" />
      </div>
      <h3 className="mt-5 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
        No settlements yet.
      </h3>
      <p className="mx-auto mt-2 max-w-lg text-[14px] leading-6 text-[var(--text-2)]">
        Your offramp receipts will appear here once confirmed.
      </p>
      <Link href="/transfer" className="empty-state-cta mt-5 inline-flex items-center gap-2">
        Trigger your first offramp
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function TxRow({
  tx,
  index,
  isOpen,
  onToggle,
}: {
  tx: Transaction;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { showToast } = useToast();
  const tone =
    tx.status === "confirmed" ? "success" : tx.status === "failed" ? "danger" : "warning";

  return (
    <article
      className={cn("history-row data-row content-card animate-in p-5", isOpen && "open")}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <button type="button" onClick={onToggle} className="w-full text-left">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] bg-[var(--accent-mint)] text-[var(--text-1)]">
              <ArrowUpRight className={cn("h-5 w-5 transition-transform duration-300", isOpen && "rotate-90")} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[18px] font-[var(--font-syne)] font-[700] tracking-[-0.04em]">
                  Offramp settlement
                </h3>
                {tx.receiptId ? <StatusPill tone="dark">Receipt #{tx.receiptId}</StatusPill> : null}
                <StatusPill tone={tone} className={tx.status === "confirmed" ? "badge-confirmed" : undefined}>
                  {tx.status}
                </StatusPill>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-[var(--text-2)]">
                {tx.upiId ? (
                  <span className="rounded-full bg-[var(--bg-muted)] px-3 py-1 font-[var(--font-mono)] text-[11px] text-[var(--text-2)]">
                    To {tx.upiId}
                  </span>
                ) : null}
                <span className="font-[var(--font-mono)]">{relativeTime(tx.timestamp)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-3 sm:items-end">
            <div className="text-left sm:text-right">
              <div className="tabular-nums font-[var(--font-syne)] text-2xl font-[800] tracking-[-0.05em]">
                {tx.amount.toFixed(2)} USDC
              </div>
              {tx.inrAmount != null ? (
                <div className="tabular-nums mt-1 text-[13px] text-[var(--text-2)]">{formatInr(tx.inrAmount)}</div>
              ) : null}
            </div>
          </div>
        </div>
      </button>

      <div className="history-detail">
        <div className="mt-3 border-t border-black/8 pt-4 text-[12px] text-[var(--text-2)]">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.2em] text-[var(--text-3)]">
                Full timestamp
              </p>
              <p className="mt-1">
                {new Intl.DateTimeFormat("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "medium",
                }).format(new Date(tx.timestamp))}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.2em] text-[var(--text-3)]">
                INR at settlement
              </p>
              <p className="mt-1">{tx.inrAmount != null ? formatInr(tx.inrAmount) : "Unavailable"}</p>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.2em] text-[var(--text-3)]">
              Transaction signature
            </p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <code className="rounded-xl bg-[var(--bg-muted)] px-3 py-2 font-[var(--font-mono)] text-[11px] text-[var(--text-2)]">
                {tx.id}
              </code>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(tx.id);
                    showToast("Address copied to clipboard", "success");
                  }}
                  className="btn-ghost"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </button>
                <a
                  href={tx.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary w-auto rounded-full px-4 py-2 text-[11px]"
                >
                  View on Explorer
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
