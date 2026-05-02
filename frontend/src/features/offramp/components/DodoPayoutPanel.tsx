"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle,
  ExternalLink,
  Loader2,
  Receipt,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { StatusPill } from "@/components/ui/StatusPill";
import { useToast } from "@/hooks/useToast";
import { useHybridAuth } from "@/hooks/useHybridAuth";
import { isValidUpiFormat } from "@/features/offramp/utils/upi-validation";
import { cn, explorerUrl, formatInr, shortAddress } from "@/lib/utils";

type DodoUiPhase = "INPUT" | "QUOTE" | "SETTLING" | "SUCCESS";

interface DodoClaimResponse {
  dodoPaymentId: string;
  usdcAmount: number;
  usdcAmountFormatted: string;
  inrQuoteIndicative: number;
  status: string;
}

interface DodoExecuteResponse {
  transferId?: string | null;
  solanaTx?: string | null;
  status: string;
  message?: string;
  serializedTransaction?: string;
  lastValidBlockHeight?: number;
}

interface DodoStatusResponse {
  dodoPaymentId: string;
  status: string;
  amountUsd: number;
  usdcAmount: number | null;
  transferId: string | null;
  solanaTx: string | null;
  createdAt: number;
  claimedAt: number | null;
  executedAt: number | null;
  offrampStatus: string | null;
  utr: string | null;
  requiresReview: boolean | null;
  completedAt: string | null;
}

interface ApiErrorPayload {
  error?: string;
}

function formatUsdAmount(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(parsed);
}

function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as ApiErrorPayload).error === "string" &&
    (payload as ApiErrorPayload).error?.trim()
  ) {
    return (payload as ApiErrorPayload).error as string;
  }

  return fallback;
}

async function parseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function isSuccessStatus(status: DodoStatusResponse | null): boolean {
  if (!status) {
    return false;
  }

  return status.offrampStatus === "SUCCESS" || status.status === "SETTLED";
}

export function DodoPayoutPanel() {
  const { showToast } = useToast();
  const { signTransaction } = useWallet();
  const {
    authState,
    isRefreshing,
    isAuthenticatingWallet,
    isLinking,
    ensureLinkedIdentity,
  } = useHybridAuth();
  const [phase, setPhase] = useState<DodoUiPhase>("INPUT");
  const [dodoPaymentId, setDodoPaymentId] = useState("");
  const [upiHandle, setUpiHandle] = useState("");
  const [claimQuote, setClaimQuote] = useState<DodoClaimResponse | null>(null);
  const [execution, setExecution] = useState<DodoExecuteResponse | null>(null);
  const [statusData, setStatusData] = useState<DodoStatusResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  useEffect(() => {
    if (phase !== "SETTLING" || !dodoPaymentId.trim()) {
      setIsPolling(false);
      return;
    }

    let cancelled = false;
    let intervalId: number | null = null;

    const pollStatus = async () => {
      try {
        setIsPolling(true);
        const response = await fetch(`/api/dodo/status/${encodeURIComponent(dodoPaymentId.trim())}`, {
          cache: "no-store",
          credentials: "include",
        });
        const payload = await parseJson<DodoStatusResponse | ApiErrorPayload>(response);

        if (!response.ok) {
          throw new Error(getApiErrorMessage(payload, "Unable to refresh Dodo payout status."));
        }

        if (!payload || !("dodoPaymentId" in payload)) {
          throw new Error("Dodo status returned an invalid response.");
        }

        if (cancelled) {
          return;
        }

        setStatusData(payload);
        setExecution((current) => ({
          transferId: payload.transferId ?? current?.transferId ?? null,
          solanaTx: payload.solanaTx ?? current?.solanaTx ?? null,
          status: payload.status,
          message: current?.message,
        }));

        if (isSuccessStatus(payload)) {
          setPhase("SUCCESS");
          setIsPolling(false);
          if (intervalId !== null) {
            window.clearInterval(intervalId);
          }
        }
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unable to refresh Dodo payout status.";
        showToast(message, "error");
      } finally {
        if (!cancelled) {
          setIsPolling(false);
        }
      }
    };

    void pollStatus();
    intervalId = window.setInterval(() => {
      void pollStatus();
    }, 5000);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [dodoPaymentId, phase, showToast]);

  const canClaim = dodoPaymentId.trim() !== "" && isValidUpiFormat(upiHandle.trim());
  const canExecute =
    phase === "QUOTE" &&
    !!claimQuote &&
    claimQuote.status === "READY_FOR_RELAY" &&
    claimQuote.dodoPaymentId === dodoPaymentId.trim();
  const explorerHref = execution?.solanaTx ? explorerUrl(execution.solanaTx) : null;
  const solanaFmHref = execution?.solanaTx
    ? `https://solana.fm/tx/${encodeURIComponent(execution.solanaTx)}?cluster=devnet-solana`
    : null;

  const handlePaymentIdChange = (value: string) => {
    setDodoPaymentId(value);
    setErrorMessage(null);
    setClaimQuote(null);
    setExecution(null);
    setStatusData(null);
    setPhase("INPUT");
  };

  const handleUpiChange = (value: string) => {
    setUpiHandle(value.toLowerCase());
    setErrorMessage(null);
    if (phase !== "INPUT") {
      setClaimQuote(null);
      setExecution(null);
      setStatusData(null);
      setPhase("INPUT");
    }
  };

  const prepareDodoAction = async () => {
    try {
      return await ensureLinkedIdentity({ callbackUrl: "/transfer", preferWalletFirst: true });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unable to verify your RailFi auth state.";
      if (message !== "Redirecting to Google sign-in...") {
        setErrorMessage(message);
        showToast(message, "error");
      }
      throw error;
    }
  };

  const handleClaim = async () => {
    setErrorMessage(null);
    setIsClaiming(true);

    try {
      await prepareDodoAction();

      const response = await fetch("/api/dodo/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          dodoPaymentId: dodoPaymentId.trim(),
          upiHandle: upiHandle.trim(),
        }),
      });
      const payload = await parseJson<DodoClaimResponse | ApiErrorPayload>(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Unable to claim Dodo intent."));
      }

      if (!payload || !("dodoPaymentId" in payload)) {
        throw new Error("Dodo claim returned an invalid response.");
      }

      setClaimQuote(payload);
      setExecution(null);
      setStatusData(null);
      setPhase("QUOTE");
      showToast("Intent claimed. Quote locked and ready for review.", "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to claim Dodo intent.";
      setClaimQuote(null);
      setExecution(null);
      setStatusData(null);
      setPhase("INPUT");
      setErrorMessage(message);
      showToast(message, "error");
    } finally {
      setIsClaiming(false);
    }
  };

  const handleExecute = async () => {
    if (!canExecute) {
      const message = "Claim the Dodo intent successfully before executing the payout.";
      setErrorMessage(message);
      showToast(message, "error");
      return;
    }

    setErrorMessage(null);
    setIsExecuting(true);

    try {
      await prepareDodoAction();

      const response = await fetch("/api/dodo/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          dodoPaymentId: dodoPaymentId.trim(),
        }),
      });
      let payload = await parseJson<DodoExecuteResponse | ApiErrorPayload>(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Unable to execute Dodo payout."));
      }

      if (!payload || !("status" in payload)) {
        throw new Error("Dodo execute returned an invalid response.");
      }

      if (payload.status === "SIGNATURE_REQUIRED") {
        if (!payload.serializedTransaction || !payload.lastValidBlockHeight) {
          throw new Error("Dodo execute did not return a signable transaction.");
        }
        if (!signTransaction) {
          throw new Error("Wallet does not support transaction signing.");
        }

        const preparedTransaction = Transaction.from(
          Buffer.from(payload.serializedTransaction, "base64"),
        );
        const signedTransaction = await signTransaction(preparedTransaction);
        const submitResponse = await fetch("/api/dodo/execute", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            dodoPaymentId: dodoPaymentId.trim(),
            serializedTransaction: Buffer.from(signedTransaction.serialize()).toString("base64"),
            lastValidBlockHeight: payload.lastValidBlockHeight,
          }),
        });
        const submitPayload = await parseJson<DodoExecuteResponse | ApiErrorPayload>(submitResponse);

        if (!submitResponse.ok) {
          throw new Error(getApiErrorMessage(submitPayload, "Unable to submit signed Dodo payout."));
        }
        if (!submitPayload || !("status" in submitPayload)) {
          throw new Error("Dodo signed execute returned an invalid response.");
        }

        payload = submitPayload;
      }

      setExecution(payload);
      setStatusData((current) => ({
        dodoPaymentId: dodoPaymentId.trim(),
        status: payload.status,
        amountUsd: current?.amountUsd ?? 0,
        usdcAmount: claimQuote?.usdcAmount ?? current?.usdcAmount ?? null,
        transferId: payload.transferId ?? current?.transferId ?? null,
        solanaTx: payload.solanaTx ?? current?.solanaTx ?? null,
        createdAt: current?.createdAt ?? Date.now(),
        claimedAt: current?.claimedAt ?? Date.now(),
        executedAt: Date.now(),
        offrampStatus: current?.offrampStatus ?? null,
        utr: current?.utr ?? null,
        requiresReview: current?.requiresReview ?? null,
        completedAt: current?.completedAt ?? null,
      }));
      setPhase("SETTLING");
      showToast(payload.message ?? "Gasless payout submitted successfully.", "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to execute Dodo payout.";
      setErrorMessage(message);
      showToast(message, "error");
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <section className="section-shell content-card animate-in rounded-2xl p-5 sm:p-6" style={{ animationDelay: "380ms" }}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Dodo payout
          </p>
          <h2 className="mt-2 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
            Convert a Dodo payment into a gasless RailFi payout.
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--text-2)]">
            Claim the payment intent, review the payout quote, then let RailFi settle it on-chain and track the payout rail to completion.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={phase === "SUCCESS" ? "success" : phase === "SETTLING" ? "warning" : "neutral"}>
            {phase === "SUCCESS" ? <CheckCircle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {phase}
          </StatusPill>
          <StatusPill tone="darkSoft">
            <Receipt className="h-3.5 w-3.5" />
            Dodo x RailFi
          </StatusPill>
        </div>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <div className="metric-panel-dark dark-card rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
                State machine
              </p>
              <h3 className="text-heavy-primary mt-2 text-xl font-[var(--font-syne)] font-[800] tracking-[-0.04em]">
                {phase === "INPUT" && "Claim the payment intent"}
                {phase === "QUOTE" && "Review the locked quote"}
                {phase === "SETTLING" && "Settlement is in flight"}
                {phase === "SUCCESS" && "Payout completed successfully"}
              </h3>
            </div>
            <div className="surface-heavy-elevated text-heavy-secondary rounded-full p-2">
              {phase === "INPUT" ? <Wallet className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
            </div>
          </div>

          {phase === "INPUT" ? (
            <div className="mt-5 space-y-4">
              <div>
                <label className="text-heavy-muted mb-2 block text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
                  Dodo payment id
                </label>
                <input
                  type="text"
                  className="rp-input-dark"
                  placeholder="pay_123456789"
                  value={dodoPaymentId}
                  onChange={(event) => handlePaymentIdChange(event.target.value)}
                  disabled={isClaiming}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              <div>
                <label className="text-heavy-muted mb-2 block text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
                  Destination UPI handle
                </label>
                <input
                  type="text"
                  className={cn(
                    "rp-input-dark",
                    upiHandle.trim() !== "" && !isValidUpiFormat(upiHandle.trim()) && "border-red-400/70",
                  )}
                  placeholder="yourname@upi"
                  value={upiHandle}
                  onChange={(event) => handleUpiChange(event.target.value)}
                  disabled={isClaiming}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="mt-2 text-[11px] text-[var(--text-3)]">
                  This must match the founder session that owns the staged Dodo payment intent.
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--border-heavy)] bg-[var(--surface-heavy-soft)] px-4 py-3 text-[12px] text-[var(--text-2)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>Google session</span>
                  <span className="font-[var(--font-mono)] text-[var(--text-heavy-primary)]">
                    {isRefreshing ? "Checking..." : authState?.googleSessionActive ? "Linked" : "Required"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <span>Wallet session</span>
                  <span className="font-[var(--font-mono)] text-[var(--text-heavy-primary)]">
                    {isAuthenticatingWallet || isRefreshing || isLinking
                      ? "Checking..."
                      : authState?.walletAddress ?? "Required"}
                  </span>
                </div>
                {!authState?.googleSessionActive ? (
                  <GoogleSignInButton
                    callbackUrl="/transfer"
                    className="btn-ghost-dark mt-3 inline-flex w-auto rounded-full px-4 py-2 text-[11px]"
                  >
                    Sign in with Google
                  </GoogleSignInButton>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => void handleClaim()}
                disabled={!canClaim || isClaiming || isAuthenticatingWallet || isRefreshing || isLinking}
                className="btn-primary rounded-lg"
              >
                {isClaiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                Claim Intent
              </button>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-[var(--border-heavy)] bg-[var(--surface-heavy-soft)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
                    Locked summary
                  </p>
                  <StatusPill tone={phase === "SUCCESS" ? "success" : "darkSoft"}>
                    {phase === "SUCCESS" ? "Complete" : "In progress"}
                  </StatusPill>
                </div>
                <div className="mt-4 space-y-3 text-[12px] text-[var(--text-2)]">
                  <div className="flex items-center justify-between gap-4">
                    <span>Dodo payment</span>
                    <code className="rounded-full bg-black/20 px-3 py-1 font-[var(--font-mono)] text-[11px] text-[var(--text-heavy-primary)]">
                      {shortAddress(dodoPaymentId.trim(), 6)}
                    </code>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>UPI handle</span>
                    <span className="font-[var(--font-mono)] text-[var(--text-heavy-primary)]">{upiHandle}</span>
                  </div>
                  {execution?.transferId ? (
                    <div className="flex items-center justify-between gap-4">
                      <span>Transfer id</span>
                      <span className="font-[var(--font-mono)] text-[var(--text-heavy-primary)]">
                        {shortAddress(execution.transferId, 8)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              {execution?.solanaTx ? (
                <div className="rounded-2xl border border-[var(--border-heavy)] bg-[var(--surface-heavy-soft)] p-4">
                  <p className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
                    Solana transaction
                  </p>
                  <code className="text-heavy-primary mt-3 block break-all rounded-xl bg-black/20 px-3 py-3 font-[var(--font-mono)] text-[11px]">
                    {execution.solanaTx}
                  </code>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {explorerHref ? (
                      <a
                        href={explorerHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary btn-accent w-auto rounded-full px-4 py-2 text-[11px]"
                      >
                        View on Explorer
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    {solanaFmHref ? (
                      <a
                        href={solanaFmHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-ghost-dark w-auto rounded-full px-4 py-2 text-[11px]"
                      >
                        Open SolanaFM
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {phase === "SUCCESS" && statusData?.utr ? (
                <div className="rounded-2xl border border-[var(--green-border)] bg-[var(--mint-soft)] p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--green)]" />
                    <div>
                      <p className="text-[13px] font-[var(--font-syne)] font-[700] text-[#14532d]">
                        Cashfree payout confirmed
                      </p>
                      <p className="mt-1 text-[11px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[#14532d]/80">
                        UTR
                      </p>
                      <div className="mt-2 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.04em] text-[#14532d]">
                        {statusData.utr}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {errorMessage ? (
            <div className="mt-4 rounded-2xl border border-[color:var(--danger-fg)]/20 bg-[var(--danger-bg)]/55 p-4 text-[12px] text-[var(--danger-fg)]">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="surface-reset-light rounded-2xl border border-[var(--border)] bg-[var(--surface-card-soft)] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                Receipt view
              </p>
              <h3 className="mt-2 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
                {phase === "INPUT" && "Preview the claim-to-payout flow"}
                {phase === "QUOTE" && "Quote ready for confirmation"}
                {phase === "SETTLING" && "Watching payout rail confirmations"}
                {phase === "SUCCESS" && "Settlement confirmed end to end"}
              </h3>
            </div>
            <StatusPill tone={phase === "SUCCESS" ? "success" : phase === "SETTLING" ? "warning" : "neutral"}>
              {phase === "SETTLING" && isPolling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {phase === "SUCCESS" ? "Success" : phase === "SETTLING" ? "Polling" : "Awaiting action"}
            </StatusPill>
          </div>

          {phase === "INPUT" ? (
            <div className="mt-6 rounded-[24px] border border-dashed border-[var(--border)] bg-white/60 p-6 text-center">
              <p className="text-[13px] text-[var(--text-2)]">
                Enter a Dodo payment id and destination UPI handle to claim the staged backend intent and unlock the payout quote.
              </p>
            </div>
          ) : null}

          {phase === "QUOTE" && claimQuote ? (
            <div className="mt-6 rounded-[28px] border border-[var(--border)] bg-white/80 p-5 shadow-[0_20px_50px_rgba(31,24,17,0.06)]">
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-black/10 pb-4">
                <div>
                  <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                    Indicative receipt
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--text-2)]">
                    Review the quote before the gasless relay submits the payout transaction.
                  </p>
                </div>
                <StatusPill tone="success">Quote locked</StatusPill>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-[var(--surface-card-soft)] p-4">
                  <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--text-3)]">
                    USDC to route
                  </p>
                  <div className="mt-2 text-4xl font-[var(--font-syne)] font-[800] tracking-[-0.06em]">
                    {formatUsdAmount(claimQuote.usdcAmountFormatted)}
                  </div>
                  <p className="mt-2 text-[12px] text-[var(--text-2)]">USDC, using the backend’s fresh Pyth quote.</p>
                </div>

                <div className="rounded-2xl bg-[var(--surface-card-soft)] p-4">
                  <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--text-3)]">
                    INR indicative
                  </p>
                  <div className="mt-2 text-4xl font-[var(--font-syne)] font-[800] tracking-[-0.06em]">
                    {formatInr(claimQuote.inrQuoteIndicative)}
                  </div>
                  <p className="mt-2 text-[12px] text-[var(--text-2)]">Indicative payout value before Cashfree completion.</p>
                </div>
              </div>

              <div className="mt-5 space-y-3 border-t border-dashed border-black/10 pt-4 text-[12px] text-[var(--text-2)]">
                <div className="flex items-center justify-between gap-4">
                  <span>Dodo payment id</span>
                  <span className="font-[var(--font-mono)] text-[var(--text-1)]">{dodoPaymentId.trim()}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>Destination UPI</span>
                  <span className="font-[var(--font-mono)] text-[var(--text-1)]">{upiHandle}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void handleExecute()}
                disabled={!canExecute || isExecuting || isAuthenticatingWallet || isRefreshing || isLinking}
                className="btn-primary btn-accent mt-5 rounded-lg"
              >
                {isExecuting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                Execute Gasless Payout
              </button>
            </div>
          ) : null}

          {(phase === "SETTLING" || phase === "SUCCESS") ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-[28px] border border-[var(--border)] bg-white/80 p-5 shadow-[0_20px_50px_rgba(31,24,17,0.06)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--text-3)]">
                      Settlement tracker
                    </p>
                    <h4 className="mt-2 text-xl font-[var(--font-syne)] font-[800] tracking-[-0.04em]">
                      {phase === "SUCCESS" ? "UTR is ready and payout is complete." : "On-chain transaction confirmed. Waiting for payout rail updates."}
                    </h4>
                  </div>
                  <StatusPill tone={phase === "SUCCESS" ? "success" : "warning"}>
                    {phase === "SUCCESS" ? <CheckCircle className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {phase === "SUCCESS" ? "Settled" : "Settling"}
                  </StatusPill>
                </div>

                <div className="mt-5 grid gap-3 text-[12px] text-[var(--text-2)] md:grid-cols-2">
                  <div className="rounded-2xl bg-[var(--surface-card-soft)] p-4">
                    <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--text-3)]">
                      RailFi transfer id
                    </p>
                    <p className="mt-2 font-[var(--font-mono)] text-[var(--text-1)]">
                      {execution?.transferId ?? statusData?.transferId ?? "Pending"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[var(--surface-card-soft)] p-4">
                    <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--text-3)]">
                      Payout status
                    </p>
                    <p className="mt-2 font-[var(--font-mono)] text-[var(--text-1)]">
                      {statusData?.offrampStatus ?? statusData?.status ?? execution?.status ?? "Pending"}
                    </p>
                  </div>
                </div>

                {statusData?.requiresReview ? (
                  <div className="mt-4 rounded-2xl border border-[color:var(--warning-fg)]/20 bg-[var(--warning-bg)]/55 px-4 py-3 text-[12px] text-[var(--warning-fg)]">
                    This payout has been flagged for review. Keep the transfer id available for support follow-up.
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
