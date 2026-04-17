"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Wallet,
} from "lucide-react";
import { ClientWalletMultiButton } from "@/components/ClientWalletMultiButton";
import { ProgramIdBadge } from "@/components/ProgramIdBadge";
import { usePythPrice, PYTH_FEED_IDS } from "@/lib/pyth";
import { useRailpayContext } from "@/providers/RailpayProvider";
import { useToast } from "@/hooks/useToast";
import { calculateOfframpChargeBreakdown } from "@/lib/referrals";
import { useWalletSession } from "@/components/WalletSessionProvider";
import type { InvoiceRecord, PublicInvoiceRecord } from "@/types/invoice";

interface PayInvoiceClientProps {
  invoice: PublicInvoiceRecord | null;
}

export function PayInvoiceClient({ invoice }: PayInvoiceClientProps) {
  const { publicKey, connected, signMessage } = useWallet();
  const { ensureSession } = useWalletSession();
  const { showToast } = useToast();
  const {
    balances,
    vault,
    txPhase,
    txResult,
    txError,
    depositPhase,
    depositError,
    initializeVault,
    depositUsdc,
    triggerOfframp,
    resetTx,
    isProtocolReady,
  } = useRailpayContext();
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [isMarkedPaid, setIsMarkedPaid] = useState(false);
  const [settlementUpiId, setSettlementUpiId] = useState<string | null>(null);
  const [isResolvingDestination, setIsResolvingDestination] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [checkoutAction, setCheckoutAction] = useState<"idle" | "init" | "offramp">("idle");

  const { data: usdcUsdPrice, isLoading: loadingUsdc } = usePythPrice(PYTH_FEED_IDS.USDC_USD);
  const { data: usdInrPrice, isLoading: loadingInr } = usePythPrice(PYTH_FEED_IDS.USD_INR);
  const publicKeyBase58 = publicKey?.toBase58() ?? null;

  const isExpired =
    !invoice ||
    invoice.status === "EXPIRED" ||
    (!!invoice.expiresAt && invoice.expiresAt <= now);
  const isPaid = invoice?.status === "PAID" || isMarkedPaid;
  const amount = invoice?.amount ?? 0;
  const chargeBreakdown = useMemo(
    () => calculateOfframpChargeBreakdown(amount, null),
    [amount],
  );
  const totalRequired = chargeBreakdown.totalDeductedUsdc;
  const protocolFeeUsdc = Math.max(totalRequired - amount, 0);
  const estimatedInr = useMemo(() => {
    if (!invoice || !usdcUsdPrice || !usdInrPrice) {
      return null;
    }
    return amount * usdcUsdPrice.price * usdInrPrice.price;
  }, [amount, invoice, usdInrPrice, usdcUsdPrice]);
  const inrPaise = estimatedInr !== null ? Math.round(estimatedInr * 100) : 0;
  const hasVault = vault !== null;
  const canDeposit = !!vault && balances.usdc >= totalRequired && totalRequired > 0;
  const hasEnoughInVault = (vault?.availableUsdc ?? 0) >= totalRequired;
  const isOfframpProcessing = ["awaiting_signature", "confirming", "settling"].includes(txPhase);
  const isDepositProcessing = ["awaiting_signature", "confirming"].includes(depositPhase);
  const isLoading =
    isOfframpProcessing || isDepositProcessing || isMarkingPaid || isResolvingDestination;

  useEffect(() => {
    if (!invoice?.expiresAt || isPaid) {
      return;
    }

    const interval = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [invoice?.expiresAt, isPaid]);

  useEffect(() => {
    setSettlementUpiId(null);
  }, [invoice?.id, publicKeyBase58]);

  const markInvoicePaid = useCallback(async () => {
    if (!invoice || !publicKey || !txResult?.signature || isMarkingPaid || isMarkedPaid) {
      return;
    }

    setIsMarkingPaid(true);
    try {
      await ensureSession();
      const response = await fetch(`/api/invoices/${invoice.id}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offrampTxSig: txResult.signature,
        }),
      });
      const payload = (await response.json()) as InvoiceRecord | { error?: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Failed to mark invoice paid.");
      }
      setIsMarkedPaid(true);
      showToast("Invoice marked paid", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to mark invoice paid.", "error");
    } finally {
      setIsMarkingPaid(false);
    }
  }, [ensureSession, invoice, isMarkedPaid, isMarkingPaid, publicKey, showToast, txResult?.signature]);

  const resolveSettlementUpiId = useCallback(async (): Promise<string | null> => {
    if (settlementUpiId) {
      return settlementUpiId;
    }

    if (!invoice || !publicKey) {
      throw new Error("Connect a wallet with message-signing support to continue.");
    }

    setIsResolvingDestination(true);
    try {
      await ensureSession();
      const response = await fetch(`/api/invoices/${invoice.id}/pay-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = (await response.json()) as
        | { destinationUpiId?: string; error?: string }
        | { error?: string };
      if (
        !response.ok ||
        !("destinationUpiId" in payload) ||
        !payload.destinationUpiId
      ) {
        throw new Error(
          "error" in payload ? payload.error ?? "Unable to load settlement destination." : "Unable to load settlement destination.",
        );
      }

      setSettlementUpiId(payload.destinationUpiId);
      return payload.destinationUpiId;
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error("Unable to load settlement destination.");
    } finally {
      setIsResolvingDestination(false);
    }
  }, [ensureSession, invoice, publicKey, settlementUpiId]);

  useEffect(() => {
    if (checkoutAction === "offramp" && txPhase === "done" && txResult?.signature) {
      void markInvoicePaid();
    }
  }, [checkoutAction, markInvoicePaid, txPhase, txResult?.signature]);

  useEffect(() => {
    setCheckoutAction((current) => {
      if (current === "init" && (txPhase === "done" || txPhase === "error" || txPhase === "idle")) {
        return "idle";
      }
      if (current === "offramp" && (txPhase === "error" || isMarkedPaid)) {
        return "idle";
      }
      return current;
    });
  }, [isMarkedPaid, txPhase]);

  async function handleInitializeVault() {
    try {
      const destinationUpiId = await resolveSettlementUpiId();
      if (!destinationUpiId) {
        showToast("Invoice is missing a settlement destination.", "error");
        return;
      }
      setCheckoutAction("init");
      await initializeVault(destinationUpiId);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to prepare invoice checkout.",
        "error",
      );
    }
  }

  async function handleDeposit() {
    if (!canDeposit) {
      showToast("You need wallet USDC available before funding the vault.", "error");
      return;
    }
    try {
      await depositUsdc(totalRequired);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to fund the vault right now.",
        "error",
      );
    }
  }

  async function handlePayInvoice() {
    if (!invoice || estimatedInr === null || inrPaise <= 0) {
      return;
    }

    try {
      const destinationUpiId = await resolveSettlementUpiId();
      if (!destinationUpiId) {
        showToast("Invoice is missing a settlement destination.", "error");
        return;
      }

      setCheckoutAction("offramp");
      resetTx();
      await triggerOfframp(amount, destinationUpiId, inrPaise);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Unable to prepare invoice checkout.",
        "error",
      );
    }
  }

  if (!invoice) {
    return (
      <section className="mesh-bg min-h-screen px-4 py-8">
        <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-[0_24px_90px_rgba(10,10,10,0.12)]">
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Invoice unavailable
          </p>
          <h1 className="mt-3 font-[var(--font-syne)] text-4xl font-[800] tracking-[-0.06em] text-[var(--text-1)]">
            This payment link could not be found.
          </h1>
          <Link href="/" className="btn-ghost mt-6 inline-flex rounded-lg">
            <ArrowLeft className="h-4 w-4" />
            Back to RailFi
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="mesh-bg min-h-screen px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="btn-ghost rounded-lg">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <ClientWalletMultiButton />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <div className="metric-panel-dark dark-card rounded-3xl p-6">
            <p className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
              RailFi invoice
            </p>
            <h1 className="text-heavy-primary mt-3 font-[var(--font-syne)] text-4xl font-[800] tracking-[-0.06em]">
              {invoice.description || "Freelancer invoice checkout"}
            </h1>
            <p className="text-heavy-secondary mt-3 text-[14px] leading-7">
              Settle this invoice in USDC, then RailFi routes the payout to the destination UPI on-chain.
            </p>

            <div className="mt-8 space-y-4">
              <div className="rounded-2xl bg-white/8 p-4">
                <p className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
                  Amount due
                </p>
                <p className="text-heavy-primary mt-2 tabular-nums font-[var(--font-syne)] text-4xl font-[800] tracking-[-0.05em]">
                  {invoice.amount.toFixed(2)} USDC
                </p>
                <p className="text-heavy-secondary mt-2 text-[13px]">
                  {loadingUsdc || loadingInr || estimatedInr === null
                    ? "Fetching live INR reference..."
                    : new Intl.NumberFormat("en-IN", {
                        style: "currency",
                        currency: "INR",
                        maximumFractionDigits: 2,
                      }).format(estimatedInr)}
                </p>
              </div>

              <div className="rounded-2xl bg-white/8 p-4">
                <p className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
                  Invoice state
                </p>
                <p className="text-heavy-primary mt-2 text-sm">
                  {isPaid ? "Paid" : isExpired ? "Expired" : "Open"}
                </p>
                <p className="text-heavy-secondary mt-2 text-[13px]">
                  {invoice.expiresAt
                    ? `Expires ${new Date(invoice.expiresAt * 1000).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}`
                    : "No auto-expiry set"}
                </p>
              </div>
            </div>
          </div>

          <div className="section-shell rounded-3xl p-6">
            {isPaid ? (
              <div className="invoice-confetti relative overflow-hidden rounded-3xl bg-[var(--green-soft)] p-6">
                <div className="relative z-10">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--green)]/20 text-[var(--green-strong)]">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <h2 className="mt-5 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
                    Invoice paid successfully.
                  </h2>
                  <p className="mt-2 text-[14px] leading-7 text-[var(--text-2)]">
                    The settlement request is confirmed and the invoice is now locked as paid.
                  </p>
                  {txResult?.explorerUrl || invoice.offrampTxSig ? (
                    <a
                      href={txResult?.explorerUrl ?? `https://explorer.solana.com/tx/${invoice.offrampTxSig}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary btn-accent mt-6 inline-flex rounded-lg"
                    >
                      View on Explorer
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </div>
            ) : isExpired ? (
              <div className="rounded-3xl border border-[color:var(--danger-fg)]/20 bg-[var(--danger-bg)]/55 p-6">
                <h2 className="font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--danger-fg)]">
                  This invoice has expired.
                </h2>
                <p className="mt-3 text-[14px] leading-7 text-[var(--danger-fg)]/85">
                  Payment is blocked on both the checkout and API layer. Ask the freelancer for a fresh link.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                    Checkout
                  </p>
                  <h2 className="mt-2 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
                    Pay this invoice with USDC.
                  </h2>
                  <p className="mt-2 text-[13px] leading-6 text-[var(--text-2)]">
                    RailFi will guide you through vault setup, funding, and the final offramp request.
                  </p>
                </div>

                {!connected ? (
                  <div className="rounded-2xl border border-black/10 bg-[var(--surface-muted)] p-5">
                    <p className="text-[13px] text-[var(--text-2)]">
                      Connect your wallet to start the invoice checkout.
                    </p>
                  </div>
                ) : null}

                <div className="surface-card rounded-2xl p-4">
                  <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                    Settlement destination
                  </p>
                  <p className="mt-2 text-[13px] text-[var(--text-2)]">
                    This invoice routes automatically to the freelancer&apos;s configured payout destination.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="surface-card rounded-2xl p-4">
                    <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                      Wallet
                    </p>
                    <p className="mt-2 tabular-nums font-[var(--font-syne)] text-2xl font-[800] tracking-[-0.04em] text-[var(--text-1)]">
                      {balances.usdc.toFixed(2)} USDC
                    </p>
                  </div>
                  <div className="surface-card rounded-2xl p-4">
                    <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                      Vault
                    </p>
                    <p className="mt-2 tabular-nums font-[var(--font-syne)] text-2xl font-[800] tracking-[-0.04em] text-[var(--text-1)]">
                      {(vault?.availableUsdc ?? 0).toFixed(2)} USDC
                    </p>
                  </div>
                  <div className="surface-card rounded-2xl p-4">
                    <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                      Protocol
                    </p>
                    <p className="mt-2 text-[14px] font-[var(--font-syne)] font-[700] text-[var(--text-1)]">
                      {isProtocolReady ? "Ready" : "Setup needed"}
                    </p>
                  </div>
                </div>

                {!hasVault ? (
                  <button
                    type="button"
                    onClick={() => void handleInitializeVault()}
                    className="btn-primary btn-accent rounded-lg"
                    disabled={!connected || !signMessage || isLoading}
                  >
                    {isOfframpProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                    {isResolvingDestination
                      ? "Authorizing checkout..."
                      : isOfframpProcessing
                        ? "Initializing vault..."
                        : "Initialize vault"}
                  </button>
                ) : !hasEnoughInVault ? (
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => void handleDeposit()}
                      className="btn-primary btn-accent rounded-lg"
                      disabled={!connected || !canDeposit || isLoading}
                    >
                      {isDepositProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
                      {isDepositProcessing ? "Funding vault..." : `Deposit ${totalRequired.toFixed(6)} USDC`}
                    </button>
                    <p className="text-[12px] leading-6 text-[var(--text-2)]">
                      Deposit <strong>{totalRequired.toFixed(6)} USDC</strong> to proceed.
                      <br />
                      <span className="text-[11px] text-[var(--text-3)]">
                        {amount.toFixed(2)} USDC principal + {protocolFeeUsdc.toFixed(6)} USDC protocol fee
                      </span>
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handlePayInvoice()}
                    className="btn-primary btn-accent rounded-lg"
                    disabled={
                      !connected ||
                      !signMessage ||
                      isLoading ||
                      !isProtocolReady ||
                      estimatedInr === null ||
                      inrPaise <= 0
                    }
                  >
                    {isOfframpProcessing || isMarkingPaid ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4" />
                    )}
                    {isMarkingPaid
                      ? "Finalizing invoice..."
                      : isResolvingDestination
                        ? "Authorizing checkout..."
                        : isOfframpProcessing
                          ? "Submitting settlement..."
                          : "Pay with USDC"}
                  </button>
                )}

                {!hasVault && connected ? (
                  <p className="text-[12px] text-[var(--text-2)]">
                    First payment on this wallet: initialize your RailFi vault so RailFi can route this invoice to the freelancer&apos;s saved payout destination.
                  </p>
                ) : null}
                {connected && !signMessage ? (
                  <div className="rounded-2xl border border-[color:var(--warning-fg)]/20 bg-[var(--warning-bg)]/55 p-4 text-[12px] text-[var(--warning-fg)]">
                    This wallet must support message signing to authorize invoice checkout.
                  </div>
                ) : null}
                {hasVault && !hasEnoughInVault && connected ? (
                  <p className="text-[12px] text-[var(--text-2)]">
                    This checkout uses the existing vault flow, so the full required amount including protocol fees must be deposited into your vault first.
                  </p>
                ) : null}
                {balances.usdc < totalRequired && connected ? (
                  <div className="rounded-2xl border border-[color:var(--warning-fg)]/20 bg-[var(--warning-bg)]/55 p-4 text-[12px] text-[var(--warning-fg)]">
                    Wallet balance is below the required funding amount. Top up Devnet USDC before funding the vault.
                  </div>
                ) : null}
                {depositError ? (
                  <div className="rounded-2xl border border-[color:var(--danger-fg)]/20 bg-[var(--danger-bg)]/55 p-4 text-[12px] text-[var(--danger-fg)]">
                    {depositError}
                  </div>
                ) : null}
                {txError ? (
                  <div className="rounded-2xl border border-[color:var(--danger-fg)]/20 bg-[var(--danger-bg)]/55 p-4 text-[12px] text-[var(--danger-fg)]">
                    {txError}
                  </div>
                ) : null}
                {!isProtocolReady ? (
                  <div className="rounded-2xl border border-[color:var(--warning-fg)]/20 bg-[var(--warning-bg)]/55 p-4 text-[12px] text-[var(--warning-fg)]">
                    RailFi protocol config is not ready on this environment yet.
                  </div>
                ) : null}
                {(loadingUsdc || loadingInr) && !estimatedInr ? (
                  <div className="flex items-center gap-2 text-[12px] text-[var(--text-2)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Fetching live INR quote...
                  </div>
                ) : null}
                {txResult?.explorerUrl && txPhase === "done" ? (
                  <a
                    href={txResult.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-[var(--font-mono)] text-[var(--accent-green)] hover:underline"
                  >
                    View payment on Explorer
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <ProgramIdBadge showFull={false} />
        </div>
      </div>
    </section>
  );
}
