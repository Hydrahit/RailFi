"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FilePlus2 } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useToast } from "@/hooks/useToast";
import { StatusPill } from "@/components/ui/StatusPill";
import { useWalletSession } from "@/components/WalletSessionProvider";
import type { InvoiceRecord } from "@/types/invoice";

const STATUS_TONE = {
  OPEN: "neutral",
  PAID: "success",
  EXPIRED: "warning",
} as const;

function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) {
    return "—";
  }

  return new Date(timestamp * 1000).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

interface InvoiceHistoryProps {
  refreshKey: number;
}

export function InvoiceHistory({ refreshKey }: InvoiceHistoryProps) {
  const { publicKey } = useWallet();
  const { ensureSession } = useWalletSession();
  const { showToast } = useToast();
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchInvoices = useCallback(async () => {
    if (!publicKey) {
      setInvoices([]);
      return;
    }

    setIsLoading(true);
    try {
      await ensureSession();
      const response = await fetch("/api/invoices", {
        cache: "no-store",
      });
      const payload = (await response.json()) as { invoices?: InvoiceRecord[]; error?: string };
      if (!response.ok || !payload.invoices) {
        throw new Error(payload.error ?? "Failed to load invoices.");
      }
      setInvoices(payload.invoices);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to load invoices.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [ensureSession, publicKey, showToast]);

  useEffect(() => {
    void fetchInvoices();
  }, [fetchInvoices, refreshKey]);

  if (!publicKey) {
    return <p className="py-6 text-[13px] text-[var(--text-2)]">Connect a wallet to create and manage invoices.</p>;
  }

  if (isLoading) {
    return (
      <div className="space-y-3 py-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="surface-card rounded-2xl p-4">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton mt-3 h-8 w-40" />
            <div className="skeleton mt-3 h-4 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <div className="py-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--text-2)]">
          <FilePlus2 className="h-5 w-5" />
        </div>
        <p className="mt-4 font-[var(--font-syne)] text-xl font-[700] tracking-[-0.04em] text-[var(--text-1)]">
          No invoices yet.
        </p>
        <p className="mt-2 text-[13px] text-[var(--text-2)]">
          Generate your first payment link to start sharing invoice checkouts.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-black/8">
      {invoices.map((invoice) => (
        <div key={invoice.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-[var(--font-syne)] text-[18px] font-[700] tracking-[-0.04em] text-[var(--text-1)]">
                {invoice.description || "Client payment request"}
              </p>
              <StatusPill tone={STATUS_TONE[invoice.status]}>
                {invoice.status}
              </StatusPill>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-2)]">
              <span>Created {formatDateTime(invoice.createdAt)}</span>
              <span aria-hidden="true">·</span>
              <span>Expires {invoice.expiresAt ? formatDateTime(invoice.expiresAt) : "Never"}</span>
              {invoice.paidAt ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Paid {formatDateTime(invoice.paidAt)}</span>
                </>
              ) : null}
            </div>
          </div>

          <div className="text-left sm:text-right">
            <p className="tabular-nums font-[var(--font-syne)] text-[22px] font-[800] tracking-[-0.05em] text-[var(--text-1)]">
              {invoice.amount.toFixed(2)} USDC
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 sm:justify-end">
              <a
                href={`/pay/${invoice.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-[var(--font-mono)] text-[var(--accent-green)] hover:underline"
              >
                Open checkout
                <ExternalLink className="h-3 w-3" />
              </a>
              {invoice.offrampTxSig ? (
                <a
                  href={`https://explorer.solana.com/tx/${invoice.offrampTxSig}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-[var(--font-mono)] text-[var(--accent-green)] hover:underline"
                >
                  View payment
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
