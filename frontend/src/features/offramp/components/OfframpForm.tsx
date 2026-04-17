"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpRight,
  CheckCircle,
  ExternalLink,
  Lock,
  Loader2,
  ShieldCheck,
  Vault,
  Wallet,
} from "lucide-react";
import { useRailpayContext } from "@/providers/RailpayProvider";
import { RateCard } from "./RateCard";
import { validateUpi, isValidUpiFormat } from "@/features/offramp/utils/upi-validation";
import { cn } from "@/lib/utils";
import { useMinimumLoading } from "@/hooks/useMinimumLoading";
import { useDebounce } from "@/hooks/useDebounce";
import { useToast } from "@/hooks/useToast";
import { usePythPrice, PYTH_FEED_IDS } from "@/lib/pyth";
import type { FundingPhase, OfframpPhase } from "@/types/railpay";
import { TransferComposerSkeleton } from "@/components/ui/AppSkeletons";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { StatusPill } from "@/components/ui/StatusPill";
import { KycGate, type KycGateState } from "@/components/KycGate";
import { AirdropButton } from "@/components/devnet/AirdropButton";
import {
  calculateOfframpChargeBreakdown,
  fetchReferralConfig,
  maxPrincipalFromAvailableUsdc,
  type ReferralConfigAccount,
} from "@/lib/referrals";
import type { DemoUiState } from "@/features/offramp/components/TransferScreen";

const OFFRAMP_PHASE_LABELS: Record<OfframpPhase, string> = {
  idle: "Trigger settlement",
  validating: "Validating UPI",
  awaiting_signature: "Awaiting signature",
  confirming: "Confirming on-chain",
  settling: "Settling",
  done: "Settlement complete",
  error: "Try again",
};

const DEPOSIT_PHASE_LABELS: Record<FundingPhase, string> = {
  idle: "Deposit to vault",
  awaiting_signature: "Awaiting signature",
  confirming: "Confirming vault funding",
  done: "Vault funded",
  error: "Retry deposit",
};

const DEMO_PHASE_LABELS: Record<DemoUiState, string> = {
  idle: "Trigger settlement",
  offramp_pending: "Submitting gasless tx...",
  offramp_confirmed: "On-chain receipt confirmed",
  payout_pending: "Polling Cashfree...",
  payout_confirmed: "Settlement complete",
  csv_ready: "Tax CSV ready",
  error: "Try again",
};

interface DemoFlowView {
  state: DemoUiState;
  transferId: string | null;
  explorerUrl: string | null;
  utr: string | null;
  amountInr: string | null;
  csvUrl: string | null;
  error: string | null;
}

interface OfframpFormProps {
  animationSeed?: number;
  demoMode?: boolean;
  demoFlow?: DemoFlowView;
  onDemoOfframp?: (input: {
    amountMicroUsdc: string;
    upiId: string;
    inrPaise: string;
  }) => Promise<void>;
  onDemoReset?: () => void;
  onDemoCsvReady?: () => void;
}

export function OfframpForm({
  animationSeed = 0,
  demoMode = false,
  demoFlow,
  onDemoOfframp,
  onDemoReset,
  onDemoCsvReady,
}: OfframpFormProps) {
  const searchParams = useSearchParams();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const {
    balances,
    vault,
    protocolConfig,
    protocolConfigError,
    txPhase,
    txResult,
    txError,
    depositPhase,
    depositResult,
    depositError,
    depositUsdc,
    triggerOfframp,
    initializeVault,
    resetTx,
    resetDeposit,
    isReady,
    isProtocolReady,
    isBootstrapping,
  } = useRailpayContext();

  const [depositAmount, setDepositAmount] = useState("");
  const [amount, setAmount] = useState("");
  const [upiId, setUpiId] = useState("");
  const [upiStatus, setUpiStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [upiName, setUpiName] = useState("");
  const [initUpi, setInitUpi] = useState("");
  const [referralConfig, setReferralConfig] = useState<ReferralConfigAccount | null>(null);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [isReferralLoading, setIsReferralLoading] = useState(false);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [kycState, setKycState] = useState<KycGateState>({
    requiredTier: "NONE",
    approvedTier: "NONE",
    status: "not_started",
    meetsRequirement: true,
    outOfPolicy: false,
    message: "KYC is not required yet.",
  });
  const abortRef = useRef<AbortController | null>(null);
  const lastDepositAmountRef = useRef(0);
  const lastOfframpMetaRef = useRef<{ amount: number; upiId: string }>({ amount: 0, upiId: "" });
  const { showToast } = useToast();
  const debouncedAmount = useDebounce(amount, 400);

  const { data: usdcUsdPrice, isLoading: loadingUsdc, error: usdcError } =
    usePythPrice(PYTH_FEED_IDS.USDC_USD);
  const { data: usdInrPrice, isLoading: loadingInr, error: inrError } =
    usePythPrice(PYTH_FEED_IDS.USD_INR);

  const isDepositProcessing = ["awaiting_signature", "confirming"].includes(depositPhase);
  const isOfframpProcessing = ["validating", "awaiting_signature", "confirming", "settling"].includes(txPhase);
  const isDemoProcessing =
    demoMode &&
    !!demoFlow &&
    ["offramp_pending", "offramp_confirmed", "payout_pending"].includes(demoFlow.state);
  const depositAmountNum = parseFloat(depositAmount) || 0;
  const amountNum = parseFloat(amount) || 0;
  const debouncedAmountNum = parseFloat(debouncedAmount) || 0;
  const walletUsdc = balances.usdc;
  const isLowBalance = solBalance !== null && solBalance < 0.1;
  const vaultAvailableUsdc = vault?.availableUsdc ?? 0;
  const vaultEscrowUsdc = vault?.escrowUsdc ?? 0;
  const chargeBreakdown = useMemo(
    () => calculateOfframpChargeBreakdown(amountNum, referralConfig?.feeBps ?? null),
    [amountNum, referralConfig?.feeBps],
  );
  const maxPrincipalUsdc = useMemo(
    () => maxPrincipalFromAvailableUsdc(vaultAvailableUsdc, referralConfig?.feeBps ?? null),
    [referralConfig?.feeBps, vaultAvailableUsdc],
  );

  const estimatedInr = useMemo(() => {
    if (!usdcUsdPrice || !usdInrPrice || !debouncedAmount || debouncedAmountNum <= 0) {
      return null;
    }
    return debouncedAmountNum * usdcUsdPrice.price * usdInrPrice.price;
  }, [debouncedAmount, debouncedAmountNum, usdcUsdPrice, usdInrPrice]);
  const inrPaise = estimatedInr !== null ? Math.round(estimatedInr * 100) : 0;

  const isRateStale = usdcUsdPrice?.isStale || usdInrPrice?.isStale || false;
  const isRateLoading = loadingUsdc || loadingInr;
  const rateError = usdcError || inrError;
  const isFundingComplete = vaultAvailableUsdc > 0 || vaultEscrowUsdc > 0;
  const isStepTwoActive = isFundingComplete && (isOfframpProcessing || amountNum > 0 || upiId.length > 0);
  const showBootSkeleton = useMinimumLoading(isBootstrapping, 300);
  const isQuoteUpdating = amount !== debouncedAmount;
  const formattedEstimatedInr =
    estimatedInr !== null
      ? new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: "INR",
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        }).format(estimatedInr)
      : null;
  const isDemoSuccess =
    demoMode &&
    !!demoFlow &&
    (demoFlow.state === "payout_confirmed" || demoFlow.state === "csv_ready");
  const demoButtonLabel = demoFlow ? DEMO_PHASE_LABELS[demoFlow.state] : DEMO_PHASE_LABELS.idle;
  const demoStatusCopy = demoFlow
    ? {
        idle: "",
        offramp_pending: "Submitting gasless tx through the demo wallet...",
        offramp_confirmed: "On-chain settlement proof confirmed. Waiting for payout rail acknowledgement...",
        payout_pending: "Polling the demo payout rail for confirmation and UTR...",
        payout_confirmed: "Payout confirmed. Download the tax CSV to complete the walkthrough.",
        csv_ready: "Artifacts ready. You can share the UTR and export proof with judges.",
        error: demoFlow.error ?? "The simulated payout flow failed. Please try again.",
      }[demoFlow.state]
    : "";

  useEffect(() => {
    const refParam = searchParams.get("ref")?.trim();
    if (!refParam) {
      setReferralConfig(null);
      setReferralError(null);
      setIsReferralLoading(false);
      return;
    }

    let cancelled = false;
    let referrer: PublicKey;

    try {
      referrer = new PublicKey(refParam);
    } catch {
      setReferralConfig(null);
      setReferralError("Referral link is invalid and has been ignored.");
      setIsReferralLoading(false);
      return;
    }

    setIsReferralLoading(true);
    setReferralError(null);
    void fetchReferralConfig(connection, referrer)
      .then((record) => {
        if (cancelled) {
          return;
        }
        if (!record || !record.isActive) {
          setReferralConfig(null);
          setReferralError("Referral link is not active.");
          return;
        }
        setReferralConfig(record);
      })
      .catch(() => {
        if (!cancelled) {
          setReferralConfig(null);
          setReferralError("Referral link could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsReferralLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connection, searchParams]);

  useEffect(() => {
    if (!upiId) {
      setUpiStatus("idle");
      setUpiName("");
      return;
    }

    if (!isValidUpiFormat(upiId)) {
      setUpiStatus("invalid");
      setUpiName("");
      return;
    }

    setUpiStatus("checking");
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const timer = window.setTimeout(async () => {
      try {
        const response = await validateUpi(upiId, abortRef.current?.signal ?? undefined);
        if (response.isValid) {
          setUpiStatus("valid");
          setUpiName(response.name ?? response.bank ?? "");
        } else {
          setUpiStatus("invalid");
          setUpiName("");
        }
      } catch (error) {
        if (
          error instanceof DOMException && error.name === "AbortError"
        ) {
          return;
        }
        console.warn("[OfframpForm] UPI validation failed:", error);
        setUpiStatus("invalid");
        setUpiName("");
      }
    }, 500);

    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [upiId]);

  useEffect(() => {
    if (!publicKey) {
      setSolBalance(null);
      return;
    }

    let cancelled = false;
    connection.getBalance(publicKey).then((bal) => {
      if (!cancelled) {
        setSolBalance(bal / LAMPORTS_PER_SOL);
      }
    }).catch(() => {
      if (!cancelled) {
        setSolBalance(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [publicKey, connection]);

  useEffect(() => {
    if (txPhase === "done") {
      setAmount("");
      setUpiId("");
      setUpiStatus("idle");
      setUpiName("");
    }
  }, [txPhase]);

  useEffect(() => {
    if (depositPhase === "done") {
      setDepositAmount("");
    }
  }, [depositPhase]);

  useEffect(() => {
    if (depositPhase === "done" && depositResult) {
      showToast(`Vault funded - ${lastDepositAmountRef.current.toFixed(2)} USDC deposited`, "success");
    }

    if (depositPhase === "error" && depositError) {
      showToast("Transaction failed - check wallet", "error");
    }
  }, [depositError, depositPhase, depositResult, showToast]);

  useEffect(() => {
    if (txPhase === "done" && txResult) {
      showToast(`Offramp sent to ${lastOfframpMetaRef.current.upiId || "UPI destination"}`, "success");
    }

    if (txPhase === "error" && txError) {
      showToast("Transaction failed - check wallet", "error");
    }
  }, [showToast, txError, txPhase, txResult]);

  const handleDeposit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!isReady || isDepositProcessing) {
        return;
      }
      lastDepositAmountRef.current = depositAmountNum;
      await depositUsdc(depositAmountNum);
    },
    [depositAmountNum, depositUsdc, isDepositProcessing, isReady],
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!isReady || isOfframpProcessing || isQuoteUpdating || estimatedInr === null || inrPaise <= 0) {
        return;
      }
      lastOfframpMetaRef.current = { amount: amountNum, upiId };
      if (demoMode && onDemoOfframp) {
        await onDemoOfframp({
          amountMicroUsdc: Math.round(amountNum * 1_000_000).toString(),
          upiId,
          inrPaise: inrPaise.toString(),
        });
        return;
      }
      resetTx();
      await triggerOfframp(
        amountNum,
        upiId,
        inrPaise,
        referralConfig
          ? { referrer: referralConfig.referrer, feeBps: referralConfig.feeBps }
          : null,
      );
    },
    [
      amountNum,
      demoMode,
      estimatedInr,
      inrPaise,
      isOfframpProcessing,
      isQuoteUpdating,
      isReady,
      onDemoOfframp,
      referralConfig,
      resetTx,
      triggerOfframp,
      upiId,
    ],
  );

  const refreshBalance = useCallback(async () => {
    if (!publicKey) return;
    const bal = await connection.getBalance(publicKey);
    setSolBalance(bal / LAMPORTS_PER_SOL);
  }, [connection, publicKey]);

  const isDepositEnabled =
    depositAmountNum >= 0.01 &&
    depositAmountNum <= walletUsdc &&
    !isDepositProcessing &&
    !!vault &&
    isProtocolReady;

  const isSubmitEnabled =
    amountNum >= 0.01 &&
    chargeBreakdown.totalDeductedUsdc <= vaultAvailableUsdc &&
    upiStatus === "valid" &&
    !isOfframpProcessing &&
    !isDemoProcessing &&
    !isQuoteUpdating &&
    (demoMode ? !isDemoSuccess : txPhase !== "done") &&
    isProtocolReady &&
    !isRateLoading &&
    !rateError &&
    estimatedInr !== null &&
    inrPaise > 0 &&
    !isReferralLoading &&
    kycState.meetsRequirement &&
    !kycState.outOfPolicy;

  if (showBootSkeleton) {
    return <TransferComposerSkeleton />;
  }

  if (isReady && vault === null) {
    return (
      <div className="surface-hero p-6">
        <div className="max-w-2xl space-y-4">
          <StatusPill tone="dark">
            <Vault className="h-3.5 w-3.5" />
            One-time setup
          </StatusPill>
          <div>
            <h2 className="text-3xl font-[var(--font-syne)] font-[800] tracking-[-0.06em]">
              Initialize your settlement vault.
            </h2>
            <p className="mt-2 text-[14px] leading-6 text-[var(--text-2)]">
              Create the personal on-chain vault that will hold your escrowed USDC and act as the
              source of future offramp requests.
            </p>
          </div>
          <div className="space-y-3">
            <input
              className="rp-input text-center"
              placeholder="yourname@upi"
              value={initUpi}
              onChange={(event) => setInitUpi(event.target.value)}
              disabled={isOfframpProcessing}
            />
            <button
              onClick={() => initializeVault(initUpi)}
              disabled={!isValidUpiFormat(initUpi.trim().toLowerCase()) || isOfframpProcessing}
              className="btn-primary btn-accent sm:w-auto sm:px-7"
            >
              {isOfframpProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Initializing vault
                </>
              ) : (
                "Initialize vault"
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <div className="metric-panel content-card animate-in p-4 sm:p-5">
          <div className="flex items-center gap-2 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            <Wallet className="h-3.5 w-3.5" />
            Wallet balance
          </div>
          <div className="mt-3 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em]">
            {balances.isLoading ? (
              <span className="shimmer inline-block h-9 w-28 rounded-[18px]" />
            ) : (
              <AnimatedNumber
                value={walletUsdc}
                suffix=" USDC"
                animateKey={`wallet-${animationSeed}-${walletUsdc}`}
              />
            )}
          </div>
          <p className="mt-2 text-[12px] text-[var(--text-2)]">Liquid balance before vault funding</p>
        </div>

        <div className="metric-panel-dark dark-card animate-in p-4 sm:p-5" style={{ animationDelay: "80ms" }}>
          <div className="text-heavy-muted flex items-center gap-2 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
            <Vault className="h-3.5 w-3.5" />
            Vault available
          </div>
          <div className="text-heavy-primary mt-3 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em]">
            <AnimatedNumber
              value={vaultAvailableUsdc}
              suffix=" USDC"
              animateKey={`vault-${animationSeed}-${vaultAvailableUsdc}`}
            />
          </div>
          <p className="text-heavy-secondary mt-2 text-[12px]">
            Escrow reserve:{" "}
            <AnimatedNumber
              value={vaultEscrowUsdc}
              suffix=" USDC"
              animateKey={`escrow-${animationSeed}-${vaultEscrowUsdc}`}
            />
          </p>
        </div>

        <div className="metric-panel content-card animate-in p-4 sm:p-5" style={{ animationDelay: "160ms" }}>
          <div className="flex items-center gap-2 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            <ShieldCheck className="h-3.5 w-3.5" />
            Protocol state
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusPill tone={isProtocolReady ? "success" : "warning"}>
              {isProtocolReady ? "Ready" : "Setup needed"}
            </StatusPill>
            <StatusPill>{vault?.upiHandle ?? "No vault handle"}</StatusPill>
          </div>
          <p className="mt-2 text-[12px] text-[var(--text-2)]">
            Accepted mint:{" "}
            {protocolConfig
              ? `${protocolConfig.usdcMint.slice(0, 4)}...${protocolConfig.usdcMint.slice(-4)}`
              : "Pending"}
          </p>
        </div>
      </div>

      {!isProtocolReady ? (
        <div className="section-shell border border-[color:var(--warning-fg)]/20 bg-[var(--warning-bg)]/55 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning-fg)]" />
            <div>
              <p className="text-[13px] font-[var(--font-syne)] font-[700] text-[var(--warning-fg)]">
                Protocol configuration is not ready.
              </p>
              <p className="mt-1 text-[12px] text-[var(--warning-fg)]/85">
                {protocolConfigError ?? "Initialize the protocol on-chain before allowing deposits or offramps."}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-5 sm:gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <form
          onSubmit={handleDeposit}
          className={cn(
            "section-shell content-card animate-in rounded-2xl p-5 sm:p-6",
            isFundingComplete && "border-[var(--accent-green)]",
          )}
          style={{ animationDelay: "240ms" }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div>
              <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                Step 1
              </p>
              <h2 className="mt-2 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
                Fund your vault.
              </h2>
              <p className="mt-2 text-[13px] leading-6 text-[var(--text-2)]">
                Move wallet-held Devnet USDC into the RailFi vault before triggering any payout.
              </p>
            </div>
            <StatusPill tone={isFundingComplete ? "success" : "neutral"}>
              {isFundingComplete ? <CheckCircle className="h-3.5 w-3.5" /> : null}
              {isFundingComplete ? "Funded" : "Escrow reserve"}
            </StatusPill>
          </div>

          <div className="mt-5 space-y-3 sm:space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                Deposit amount
              </label>
              <button
                type="button"
                onClick={() => setDepositAmount(walletUsdc.toFixed(2))}
                className="text-[11px] font-[var(--font-mono)] text-[var(--text-2)] transition-colors hover:text-[var(--text-1)] active:opacity-70"
              >
                Max {walletUsdc.toFixed(2)}
              </button>
            </div>

            <div className="relative">
              <input
                type="number"
                className={cn("rp-input rounded-lg px-4 py-3 pr-16 text-base", depositAmountNum > walletUsdc && "border-red-400")}
                placeholder="0.00"
                value={depositAmount}
                onChange={(event) => setDepositAmount(event.target.value)}
                disabled={isDepositProcessing}
                min="0"
                step="0.01"
              />
              <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[12px] font-[var(--font-mono)] text-[var(--text-3)]">
                USDC
              </span>
            </div>

            <button
              type="submit"
              disabled={!isDepositEnabled}
              className="btn-primary btn-accent mx-auto max-w-sm rounded-lg"
            >
              {isDepositProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
              {DEPOSIT_PHASE_LABELS[depositPhase]}
            </button>

            {isLowBalance ? (
              <div className="mt-3 flex flex-col gap-1">
                <p className="text-[11px] text-current/40">
                  Need devnet SOL for gas?
                </p>
                <AirdropButton onSuccess={refreshBalance} />
              </div>
            ) : null}
          </div>

          {depositPhase === "done" && depositResult ? (
            <div className="mt-4 rounded-[24px] bg-[var(--success-bg)] p-4">
              <div className="flex items-center gap-2 text-[var(--success-fg)]">
                <CheckCircle className="h-4 w-4" />
                <span className="text-[13px] font-[var(--font-syne)] font-[700]">Vault funded successfully</span>
              </div>
              <a
                href={depositResult.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-2 text-[12px] font-[var(--font-mono)] text-[var(--success-fg)]"
              >
                View funding tx
                <ExternalLink className="h-3 w-3" />
              </a>
              <button type="button" onClick={resetDeposit} className="btn-ghost mt-4 w-full">
                Fund again
              </button>
            </div>
          ) : null}

          {depositPhase === "error" && depositError ? (
            <div className="mt-4 rounded-[24px] bg-[var(--danger-bg)] p-4 text-[12px] text-[var(--danger-fg)]">
              {depositError}
            </div>
          ) : null}
        </form>

        <form
          onSubmit={handleSubmit}
          className={cn(
            "metric-panel-dark dark-card animate-in rounded-2xl p-5 sm:p-6",
            !isFundingComplete && "step-locked",
            isStepTwoActive && "step-active",
          )}
          style={{ animationDelay: "320ms" }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div>
              <p className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
                Step 2
              </p>
              <h2 className="text-heavy-primary mt-2 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
                Trigger the offramp.
              </h2>
              <p className="text-heavy-secondary mt-2 text-[13px] leading-6">
                Compose the destination, preview the live payout estimate, and lock the on-chain rate.
              </p>
            </div>
            <StatusPill tone={isFundingComplete ? "success" : "darkSoft"}>
              {isFundingComplete ? <CheckCircle className="h-3.5 w-3.5" /> : null}
              {isFundingComplete ? "Step unlocked" : "Premium flow"}
            </StatusPill>
          </div>

          <div className="mt-5 space-y-3 sm:space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
                  Settlement amount
                </label>
                <button
                  type="button"
                  onClick={() => setAmount(maxPrincipalUsdc.toFixed(2))}
                  className="text-heavy-secondary hover:text-heavy-primary text-[11px] font-[var(--font-mono)] transition-colors active:opacity-70"
                >
                  Max {maxPrincipalUsdc.toFixed(2)}
                </button>
              </div>
              <div className="relative">
                <input
                  type="number"
                  className={cn(
                    "rp-input-dark pr-16",
                    chargeBreakdown.totalDeductedUsdc > vaultAvailableUsdc && "border-red-400/70",
                  )}
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  disabled={isOfframpProcessing || !isFundingComplete}
                  min="0"
                  step="0.01"
                />
                <span className="text-heavy-muted absolute right-5 top-1/2 -translate-y-1/2 text-[12px] font-[var(--font-mono)]">
                  USDC
                </span>
              </div>
            </div>

            <div>
              <label className="text-heavy-muted mb-2 block text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="h-3 w-3" />
                  Destination UPI ID
                </span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  className={cn(
                    "rp-input-dark pr-10",
                    upiStatus === "invalid" && "border-red-400/70",
                    upiStatus === "valid" && "border-[var(--green-border)]",
                  )}
                  placeholder="yourname@upi"
                  value={upiId}
                  onChange={(event) => setUpiId(event.target.value.toLowerCase())}
                  disabled={isOfframpProcessing || !isFundingComplete}
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  {upiStatus === "checking" ? <Loader2 className="text-heavy-muted h-4 w-4 animate-spin" /> : null}
                  {upiStatus === "valid" ? <CheckCircle className="h-4 w-4 text-[var(--green)]" /> : null}
                  {upiStatus === "invalid" ? <AlertCircle className="h-4 w-4 text-red-300" /> : null}
                </div>
              </div>
              {upiName && upiStatus === "valid" ? (
                <p className="mt-2 text-[12px] text-[var(--green)]">Verified destination: {upiName}</p>
              ) : null}
              <p className="mt-2 text-[11px] text-[var(--text-3)]">
                Hashed on-chain. Never stored in plaintext.
              </p>
            </div>

            <div className="surface-reset-light rounded-2xl p-5">
              {isRateLoading ? (
                <p className="text-[13px] text-[var(--text-2)]">Fetching live rate from Pyth...</p>
              ) : rateError ? (
                <p className="text-[13px] text-[var(--danger-fg)]">Rate feed unavailable: {rateError}</p>
              ) : estimatedInr !== null ? (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                        Estimated payout
                      </p>
                      <div
                        className={cn(
                          "mt-2 tabular-nums text-4xl font-[var(--font-syne)] font-[800] tracking-[-0.06em] transition-opacity duration-200",
                          isQuoteUpdating && "opacity-55",
                        )}
                      >
                        {formattedEstimatedInr}
                      </div>
                      {isQuoteUpdating ? (
                        <p className="mt-2 text-[11px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[var(--text-3)]">
                          Updating quote...
                        </p>
                      ) : null}
                    </div>
                    <StatusPill tone="success">Live quote</StatusPill>
                  </div>

                  {usdcUsdPrice && usdInrPrice ? (
                    <div className="mt-4 space-y-2 text-[12px] text-[var(--text-2)]">
                      <p>
                        1 USDC ~= {usdcUsdPrice.price.toFixed(4)} USD x {usdInrPrice.price.toFixed(2)} = Rs
                        {(usdcUsdPrice.price * usdInrPrice.price).toFixed(2)}
                      </p>
                      <p>
                        Confidence band ~= Rs
                        {(debouncedAmountNum * usdcUsdPrice.confidence * usdInrPrice.price).toFixed(2)}
                      </p>
                    </div>
                  ) : null}

                  {isRateStale ? (
                    <div className="mt-4 rounded-[20px] border border-[color:var(--warning-fg)]/20 bg-[var(--warning-bg)] px-4 py-3 text-[12px] text-[var(--warning-fg)]">
                      Using cached Devnet rate for testing.
                    </div>
                  ) : null}

                  <p className="mt-4 text-[12px] text-[var(--text-2)]">
                    USDC/USD locks on-chain at submission, and the current INR quote is recorded
                    with the request for audit and tax export on Devnet.
                  </p>
                </>
              ) : amountNum > 0 ? (
                <p className="text-[13px] text-[var(--text-2)]">
                  {isQuoteUpdating ? "Updating live quote..." : "Enter an amount to preview the live payout quote."}
                </p>
              ) : (
                <p className="text-[13px] text-[var(--text-2)]">Start typing an amount to unlock the live estimate.</p>
              )}
            </div>

            {referralConfig ? (
              <div className="rounded-2xl border border-[var(--accent-green)]/25 bg-[var(--accent-green-bg)]/80 px-4 py-4 text-[12px] text-[#14532d]">
                <p className="font-[var(--font-syne)] text-[15px] font-[700] text-[#14532d]">
                  Referral active
                </p>
                <p className="mt-1">
                  This transfer was opened through a referral link. RailFi adds a 1.00% protocol fee on top
                  of the payout, plus a referral reward worth {(referralConfig.feeBps / 100).toFixed(2)}% of that fee.
                </p>
                <p className="mt-2 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.14em]">
                  Total vault deduction: {chargeBreakdown.totalDeductedUsdc.toFixed(2)} USDC
                </p>
              </div>
            ) : null}

            {isReferralLoading ? (
              <div className="flex items-center gap-2 text-[12px] text-[var(--text-2)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading referral terms...
              </div>
            ) : null}

            {!referralConfig && referralError ? (
              <div className="rounded-2xl border border-[color:var(--warning-fg)]/20 bg-[var(--warning-bg)]/55 px-4 py-3 text-[12px] text-[var(--warning-fg)]">
                {referralError}
              </div>
            ) : null}

            {chargeBreakdown.totalDeductedUsdc > vaultAvailableUsdc && amountNum > 0 ? (
              <div className="rounded-2xl border border-[color:var(--warning-fg)]/20 bg-[var(--warning-bg)]/55 px-4 py-3 text-[12px] text-[var(--warning-fg)]">
                Vault balance must cover the payout plus fees. Required: {chargeBreakdown.totalDeductedUsdc.toFixed(2)} USDC.
              </div>
            ) : null}

            <KycGate
              walletAddress={publicKey?.toBase58() ?? null}
              estimatedInr={estimatedInr}
              onStateChange={setKycState}
            />

            {amountNum > 0 ? (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card-soft)] px-4 py-4 text-[13px]">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[var(--text-2)]">You receive</span>
                  <span className="text-[var(--text-1)]">{amountNum.toFixed(4)} USDC in INR</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-4">
                  <span className="text-[var(--text-2)]">Protocol fee (1%)</span>
                  <span className="text-[var(--text-1)]">
                    {chargeBreakdown.protocolFeeUsdc.toFixed(4)} USDC
                  </span>
                </div>
                {chargeBreakdown.referralFeeUsdc > 0 ? (
                  <div className="mt-2 flex items-center justify-between gap-4">
                    <span className="text-[var(--text-2)]">Referral fee</span>
                    <span className="text-[var(--text-1)]">
                      {chargeBreakdown.referralFeeUsdc.toFixed(4)} USDC
                    </span>
                  </div>
                ) : null}
                <div className="mt-2 flex items-center justify-between gap-4 border-t border-[var(--border)] pt-2 font-[700]">
                  <span className="text-[var(--text-1)]">Total from vault</span>
                  <span className="text-[var(--text-1)]">
                    {chargeBreakdown.totalDeductedUsdc.toFixed(4)} USDC
                  </span>
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={!isSubmitEnabled}
              className={cn(
                "btn-primary rounded-lg",
                (demoMode ? isDemoSuccess : txPhase === "done") && "bg-[var(--green)] text-[#052515]",
              )}
            >
              {((demoMode && isDemoProcessing) || (!demoMode && isOfframpProcessing)) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUpRight className="h-4 w-4" />
              )}
              {demoMode ? demoButtonLabel : OFFRAMP_PHASE_LABELS[txPhase]}
            </button>

            {demoMode && demoFlow && demoFlow.state !== "idle" ? (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card-soft)] px-4 py-4 text-[12px] text-[var(--text-2)]">
                <p className="font-[var(--font-syne)] text-[14px] font-[700] text-[var(--text-1)]">
                  Live demo progress
                </p>
                <p className="mt-2 leading-6">{demoStatusCopy}</p>
                {demoFlow.transferId ? (
                  <p className="mt-2 font-[var(--font-mono)] uppercase tracking-[0.14em] text-[var(--text-3)]">
                    Transfer ID: {demoFlow.transferId}
                  </p>
                ) : null}
              </div>
            ) : null}

            {!kycState.meetsRequirement && kycState.requiredTier !== "NONE" ? (
              <p className="text-heavy-secondary text-[12px]">
                Settlement unlocks once the required KYC tier is approved and the Light compliance
                proof is ready.
              </p>
            ) : null}

            {(demoMode ? isDemoSuccess : txPhase === "done") ? (
              <button
                type="button"
                onClick={demoMode ? onDemoReset : resetTx}
                className="btn-ghost-dark w-full rounded-lg"
              >
                New transfer
              </button>
            ) : null}
          </div>
        </form>
      </div>

      {(demoMode ? isDemoSuccess : txPhase === "done" && txResult) ? (
        <div className="section-shell border-em p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[var(--success-fg)]">
                <CheckCircle className="h-4 w-4" />
                <span className="text-[13px] font-[var(--font-syne)] font-[700]">Settlement triggered successfully</span>
              </div>
              {!demoMode && txResult?.receiptId != null ? (
                <p className="mt-2 text-[13px] text-[var(--text-2)]">
                  Bubblegum receipt #{txResult.receiptId} minted on-chain as permanent settlement proof.
                </p>
              ) : null}
              {demoMode && demoFlow?.amountInr ? (
                <p className="mt-2 text-[13px] text-[var(--text-2)]">
                  Demo payout confirmed for Rs {demoFlow.amountInr}. {demoFlow.utr ? `Cashfree UTR: ${demoFlow.utr}.` : ""}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href={demoMode ? demoFlow?.explorerUrl ?? "#" : txResult?.explorerUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary btn-accent sm:w-auto sm:px-6"
              >
                View on Explorer
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              {demoMode && demoFlow?.csvUrl ? (
                <a
                  href={demoFlow.csvUrl}
                  onClick={onDemoCsvReady}
                  className="btn-ghost sm:w-auto sm:px-6"
                >
                  Download Tax CSV
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {(demoMode ? demoFlow?.state === "error" && demoFlow.error : txPhase === "error" && txError) ? (
        <div className="section-shell border border-[color:var(--danger-fg)]/20 bg-[var(--danger-bg)]/55 p-4 text-[12px] text-[var(--danger-fg)]">
          {demoMode ? demoFlow?.error : txError}
        </div>
      ) : null}

      <div className="animate-in" style={{ animationDelay: "400ms" }}>
        <RateCard amount={amountNum} />
      </div>
    </div>
  );
}

