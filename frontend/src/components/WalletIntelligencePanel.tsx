"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { ArrowUpRight, Check, ExternalLink, RefreshCw } from "lucide-react";
import { explorerTx } from "@/lib/solana";
import { useMinimumLoading } from "@/hooks/useMinimumLoading";
import { useToast } from "@/hooks/useToast";
import { useUsdInrReference } from "@/hooks/useUsdInrReference";
import { WalletDashboardSkeleton } from "@/components/ui/AppSkeletons";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { TaxExportButton } from "@/components/TaxExportButton";
import { useWalletSession } from "@/components/WalletSessionProvider";

const CreateInvoiceModal = dynamic(
  () => import("@/components/CreateInvoiceModal").then((mod) => mod.CreateInvoiceModal),
  {
    ssr: false,
  },
);

const InvoiceHistory = dynamic(
  () => import("@/components/InvoiceHistory").then((mod) => mod.InvoiceHistory),
  {
    ssr: false,
    loading: () => <div className="py-6 text-[13px] text-[var(--text-2)]">Loading invoices...</div>,
  },
);

type TabKey = "ledger" | "archive" | "invoices";

interface ArchiveEntry {
  id: string;
  createdAt: number;
  usdcAmount: number;
  upiLabel: string;
  compressionStatus: "PENDING" | "COMPRESSED" | "FAILED";
  settlementStatus: string;
  signature: string | null;
  compressionError: string | null;
}

interface DashboardTransaction {
  signature: string;
  timestamp: number;
  usdcAmount: number;
  status: "PENDING" | "SETTLED" | "FAILED";
  upiId: string;
  estimatedInr: number;
}

interface DashboardCompressionRecord {
  requestId: string;
  walletAddress: string;
  usdcAmount: number;
  upiId: string;
  estimatedInr: number;
  receivedAt: number;
  signature: string;
  compressionStatus: "PENDING" | "COMPRESSED" | "FAILED";
  compressionSignature: string | null;
  compressionError: string | null;
}

interface DashboardZkRecord {
  requestId: string;
  signature: string;
  hash: string;
  owner: string;
  usdcAmount: number;
  estimatedInrPaise: number;
  upiIdPartial: string;
  status: 0 | 1 | 2;
  createdAt: number;
}

interface WalletDashboardResponse {
  balance: number;
  transactions: DashboardTransaction[];
  compressionRecords: DashboardCompressionRecord[];
  zkHistory: DashboardZkRecord[];
}

const ZK_STATUS_LABELS = {
  0: "PENDING",
  1: "SETTLED",
  2: "FAILED",
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function statusLabel(status: 0 | 1 | 2): string {
  return ZK_STATUS_LABELS[status];
}

export function WalletIntelligencePanel() {
  const { publicKey } = useWallet();
  const { ensureSession } = useWalletSession();
  const { showToast } = useToast();
  const usdInrReference = useUsdInrReference();
  const [tab, setTab] = useState<TabKey>("ledger");
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<DashboardTransaction[]>([]);
  const [compressionRecords, setCompressionRecords] = useState<DashboardCompressionRecord[]>([]);
  const [zkHistory, setZkHistory] = useState<DashboardZkRecord[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [refreshState, setRefreshState] = useState<"idle" | "loading" | "done">("idle");
  const [animationSeed, setAnimationSeed] = useState(0);
  const [invoiceRefreshKey, setInvoiceRefreshKey] = useState(0);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const isFetchingRef = useRef(false);

  const fetchAll = useCallback(async () => {
    if (!publicKey || isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;

    try {
      await ensureSession();
      const response = await fetch("/api/dashboard/wallet-intelligence", {
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | WalletDashboardResponse
        | { error?: string };

      if (!response.ok || !("balance" in payload)) {
        throw new Error(
          "error" in payload
            ? payload.error ?? "Failed to load wallet dashboard data."
            : "Failed to load wallet dashboard data.",
        );
      }

      setBalance(payload.balance);
      await sleep(160);
      setTransactions(payload.transactions);
      await sleep(180);
      setCompressionRecords(payload.compressionRecords);
      await sleep(220);
      setZkHistory(payload.zkHistory);
    } catch (error) {
      console.error("[Wallet Dashboard] Failed to load dashboard data.", error);
      setBalance(0);
      setTransactions([]);
      setCompressionRecords([]);
      setZkHistory([]);
      throw error;
    } finally {
      setHasLoaded(true);
      isFetchingRef.current = false;
    }
  }, [ensureSession, publicKey]);

  useEffect(() => {
    if (!publicKey) {
      setBalance(0);
      setTransactions([]);
      setCompressionRecords([]);
      setZkHistory([]);
      setHasLoaded(false);
      return;
    }

    setHasLoaded(false);
    void fetchAll().catch((error) => {
      console.error("[Wallet Dashboard] Initial dashboard load failed.", error);
    });
  }, [fetchAll, publicKey]);

  const showSkeleton = useMinimumLoading(!hasLoaded, 300);

  const archiveEntries = useMemo<ArchiveEntry[]>(() => {
    const compressedByRequestId = new Map(
      zkHistory.filter((record) => record.requestId).map((record) => [record.requestId, record]),
    );
    const compressedBySignature = new Map(
      zkHistory.filter((record) => record.signature).map((record) => [record.signature, record]),
    );
    const entries: ArchiveEntry[] = compressionRecords.map((record) => {
      const linkedCompressed =
        compressedByRequestId.get(record.requestId) ??
        (record.signature ? compressedBySignature.get(record.signature) : undefined);

      const upiLabel = record.upiId
        ? record.upiId.slice(0, 18)
        : linkedCompressed?.upiIdPartial
          ? `${linkedCompressed.upiIdPartial}...`
          : "UPI masked";

      return {
        id: record.requestId || record.signature,
        createdAt: record.receivedAt,
        usdcAmount: record.usdcAmount,
        upiLabel,
        compressionStatus: record.compressionStatus,
        settlementStatus: linkedCompressed ? statusLabel(linkedCompressed.status) : "PENDING",
        signature: record.signature || linkedCompressed?.signature || null,
        compressionError: record.compressionError,
      };
    });

    for (const record of zkHistory) {
      const alreadyPresent = entries.some(
        (entry) =>
          entry.id === record.requestId ||
          (record.signature && entry.signature === record.signature),
      );

      if (alreadyPresent) {
        continue;
      }

      entries.push({
        id: record.requestId || record.hash,
        createdAt: record.createdAt,
        usdcAmount: record.usdcAmount,
        upiLabel: record.upiIdPartial ? `${record.upiIdPartial}...` : "UPI masked",
        compressionStatus: "COMPRESSED",
        settlementStatus: statusLabel(record.status),
        signature: record.signature || null,
        compressionError: null,
      });
    }

    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }, [compressionRecords, zkHistory]);

  const handleRefresh = useCallback(async () => {
    if (refreshState === "loading") {
      return;
    }

    setRefreshState("loading");

    try {
      await fetchAll();
      setAnimationSeed((current) => current + 1);
      setRefreshState("done");
      showToast("Ledger synced", "success");
      window.setTimeout(() => setRefreshState("idle"), 1500);
    } catch {
      setRefreshState("idle");
      showToast("Failed to load wallet data - check your connection", "error");
    }
  }, [fetchAll, refreshState, showToast]);

  if (!publicKey) {
    return null;
  }

  if (showSkeleton) {
    return <WalletDashboardSkeleton />;
  }

  const estimatedInr =
    typeof usdInrReference === "number" ? balance * usdInrReference : null;
  const isRefreshing = refreshState === "loading";

  return (
    <section className="section-shell content-card animate-in overflow-hidden rounded-2xl p-5 sm:p-6">
      <div className="flex flex-col gap-4 border-b border-black/8 pb-5">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Wallet USDC
          </p>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 text-[12px] font-[var(--font-mono)] text-[var(--text-2)] transition-colors hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-55"
          >
            {refreshState === "done" ? (
              <Check className="h-3.5 w-3.5 text-[var(--accent-green)]" />
            ) : (
              <RefreshCw className={`h-3.5 w-3.5 refresh-icon ${isRefreshing ? "loading" : ""}`} />
            )}
            {isRefreshing ? "Syncing..." : refreshState === "done" ? "Synced" : "Refresh"}
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="font-[var(--font-syne)] text-5xl font-[800] tracking-[-0.08em] sm:text-6xl">
            <AnimatedNumber
              value={balance}
              animateKey={`wallet-panel-${animationSeed}-${balance}`}
            />
          </div>
          <span className="tabular-nums pb-2 text-sm font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--text-3)]">
            USDC
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-2)]">
          <span className="tabular-nums">
            INR{" "}
            {estimatedInr === null ? (
              "--"
            ) : (
              <AnimatedNumber
                value={estimatedInr}
                animateKey={`wallet-panel-inr-${animationSeed}-${estimatedInr}`}
                formatValue={(value) =>
                  value.toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                }
              />
            )}
          </span>
          <span aria-hidden="true">/</span>
          <span>Devnet</span>
          <span aria-hidden="true">/</span>
          <span className="inline-flex items-center gap-2 text-[var(--text-1)]">
            <span className="status-dot" />
            Live
          </span>
        </div>

        <TaxExportButton />
        <div className="flex justify-start">
          <button
            type="button"
            onClick={() => setInvoiceModalOpen(true)}
            className="btn-ghost rounded-lg"
          >
            Generate invoice
          </button>
        </div>
      </div>

      <div className="mt-4 border-b border-black/8">
        <div className="flex gap-5">
          {(["ledger", "archive", "invoices"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-3 pb-2.5 text-[12px] font-[var(--font-mono)] capitalize transition-colors border-b-2 -mb-px ${
                tab === key
                  ? "border-[#0D0D0D] text-[#0D0D0D]"
                  : "border-transparent text-[#6B6B6B] hover:text-[#0D0D0D]"
              }`}
            >
              {key === "ledger" ? "Ledger" : key === "archive" ? "Archive" : "Invoices"}
            </button>
          ))}
        </div>
      </div>

      {tab === "ledger" ? (
        transactions.length === 0 ? (
          <p className="py-6 text-[13px] text-[var(--text-2)]">No activity yet.</p>
        ) : (
          <div className="divide-y divide-black/8">
            {transactions.map((tx) => (
              <div key={tx.signature} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-[var(--font-syne)] text-[18px] font-[700] tracking-[-0.04em] text-[var(--text-1)]">
                      Offramp settlement
                    </p>
                    <span className="rounded-full bg-[var(--accent-green-bg)] px-2.5 py-1 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[#14532d]">
                      {tx.status}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-2)]">
                    <span>{new Date(tx.timestamp * 1000).toLocaleDateString("en-IN")}</span>
                    <span aria-hidden="true">/</span>
                    <span className="truncate">{tx.upiId || "UPI route pending"}</span>
                  </div>
                </div>

                <div className="text-left sm:text-right">
                  <p className="tabular-nums font-[var(--font-syne)] text-[22px] font-[800] tracking-[-0.05em] text-[var(--text-1)]">
                    {tx.usdcAmount.toFixed(2)} USDC
                  </p>
                  <a
                    href={explorerTx(tx.signature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-[var(--font-mono)] text-[var(--accent-green)] hover:underline"
                  >
                    View on Explorer
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )
      ) : tab === "archive" ? archiveEntries.length === 0 ? (
        <p className="py-6 text-[13px] text-[var(--text-2)]">No archive entries yet.</p>
      ) : (
        <div className="divide-y divide-black/8">
          {archiveEntries.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-[var(--font-syne)] text-[18px] font-[700] tracking-[-0.04em] text-[var(--text-1)]">
                    Compressed archive
                  </p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.16em] ${
                      entry.compressionStatus === "COMPRESSED"
                        ? "bg-[var(--accent-green-bg)] text-[#14532d]"
                        : entry.compressionStatus === "FAILED"
                          ? "bg-[var(--accent-peach)] text-[#92400e]"
                          : "bg-[var(--surface-muted)] text-[var(--text-2)]"
                    }`}
                    title={entry.compressionError ?? undefined}
                  >
                    {entry.compressionStatus === "COMPRESSED"
                      ? "On-chain"
                      : entry.compressionStatus === "FAILED"
                        ? "Retry"
                        : "Queued"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-2)]">
                  <span>{new Date(entry.createdAt * 1000).toLocaleDateString("en-IN")}</span>
                  <span aria-hidden="true">/</span>
                  <span className="truncate">{entry.upiLabel}</span>
                  <span aria-hidden="true">/</span>
                  <span>{entry.settlementStatus}</span>
                </div>
              </div>

              <div className="text-left sm:text-right">
                <p className="tabular-nums font-[var(--font-syne)] text-[22px] font-[800] tracking-[-0.05em] text-[var(--text-1)]">
                  {entry.usdcAmount.toFixed(2)} USDC
                </p>
                {entry.signature ? (
                  <a
                    href={explorerTx(entry.signature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-[var(--font-mono)] text-[var(--accent-green)] hover:underline"
                  >
                    Linked explorer proof
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <InvoiceHistory refreshKey={invoiceRefreshKey} />
      )}

      <CreateInvoiceModal
        open={invoiceModalOpen}
        onClose={() => setInvoiceModalOpen(false)}
        onCreated={() => {
          setInvoiceRefreshKey((current) => current + 1);
        }}
      />
    </section>
  );
}
