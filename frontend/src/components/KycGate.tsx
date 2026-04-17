"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWalletSession } from "@/components/WalletSessionProvider";
import {
  tierForEstimatedInr,
  type ComplianceTier,
  type KycLifecycleStatus,
  type KycStatusResponse,
} from "@/lib/compliance/types";

declare global {
  interface Window {
    snsWebSdk?: {
      init: (accessToken: string, config?: Record<string, unknown>) => {
        withConf?: (conf: Record<string, unknown>) => unknown;
        on?: (eventName: string, callback: (...args: unknown[]) => void) => unknown;
        build?: () => { launch: (selector: string) => void };
        launch?: (selector: string) => void;
      };
    };
  }
}

export interface KycGateState {
  requiredTier: ComplianceTier;
  approvedTier: ComplianceTier;
  status: KycLifecycleStatus;
  meetsRequirement: boolean;
  outOfPolicy: boolean;
  message: string;
}

interface KycGateProps {
  walletAddress: string | null;
  estimatedInr: number | null;
  onStateChange: (state: KycGateState) => void;
}

interface SumsubLaunchable {
  on?: (eventName: string, callback: (...args: unknown[]) => void) => unknown;
  build?: () => { launch: (selector: string) => void };
  launch?: (selector: string) => void;
}

const INITIAL_STATE: KycGateState = {
  requiredTier: "NONE",
  approvedTier: "NONE",
  status: "not_started",
  meetsRequirement: true,
  outOfPolicy: false,
  message: "KYC is not required yet.",
};

async function ensureSumsubScript(): Promise<void> {
  if (window.snsWebSdk) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-sumsub-sdk="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Sumsub SDK.")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://static.sumsub.com/idensic/static/sns-websdk-builder.js";
    script.async = true;
    script.dataset.sumsubSdk = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Sumsub SDK."));
    document.body.appendChild(script);
  });
}

export function KycGate({ walletAddress, estimatedInr, onStateChange }: KycGateProps) {
  const { ensureSession } = useWalletSession();
  const pathname = usePathname();
  const [state, setState] = useState<KycGateState>(INITIAL_STATE);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [demoStep, setDemoStep] = useState<"initializing" | "approved">("initializing");
  const [authBlocked, setAuthBlocked] = useState(false);
  const statusRequestIdRef = useRef(0);
  const demoTimerRef = useRef<number | null>(null);
  const requiredTier = useMemo(() => tierForEstimatedInr(estimatedInr), [estimatedInr]);
  const outOfPolicy = !!estimatedInr && estimatedInr > 500_000;
  const isDemoRoute = pathname === "/demo";

  useEffect(() => {
    setAuthBlocked(false);
  }, [walletAddress, requiredTier, isDemoRoute]);

  const refreshStatus = useCallback(async () => {
    const requestId = ++statusRequestIdRef.current;
    if (!walletAddress) {
      if (requestId === statusRequestIdRef.current) {
        setState(INITIAL_STATE);
      }
      return;
    }

    if (outOfPolicy) {
      if (requestId === statusRequestIdRef.current) {
        setState({
          requiredTier: "NONE",
          approvedTier: "NONE",
          status: "rejected",
          meetsRequirement: false,
          outOfPolicy: true,
          message: "This MVP supports settlements up to INR 5,00,000 only.",
        });
      }
      return;
    }

    if (requiredTier === "NONE") {
      if (requestId === statusRequestIdRef.current) {
        setState(INITIAL_STATE);
      }
      return;
    }

    if (isDemoRoute) {
      if (requestId === statusRequestIdRef.current) {
        setState({
          requiredTier,
          approvedTier: "FULL",
          status: "approved_ready",
          meetsRequirement: true,
          outOfPolicy: false,
          message: "Demo mode: KYC bypassed.",
        });
      }
      return;
    }

    if (authBlocked) {
      return;
    }

    try {
      await ensureSession();
      const response = await fetch(
        `/api/kyc/status?requiredTier=${requiredTier}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as KycStatusResponse | { error?: string };
      if (!response.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Failed to load KYC status.");
      }
      const nextData = data as KycStatusResponse;

      const nextState: KycGateState = {
        requiredTier: nextData.requiredTier,
        approvedTier: nextData.approvedTier,
        status: nextData.status,
        meetsRequirement: nextData.meetsRequirement,
        outOfPolicy: nextData.outOfPolicy,
        message: nextData.message,
      };
      if (requestId === statusRequestIdRef.current) {
        setState(nextState);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load KYC status.";
      const isUnauthorized =
        message.toLowerCase().includes("unauthorized") ||
        message.toLowerCase().includes("wallet session");
      if (requestId === statusRequestIdRef.current) {
        setState({
          requiredTier,
          approvedTier: "NONE",
          status: "not_started",
          meetsRequirement: false,
          outOfPolicy: false,
          message,
        });
      }
      if (isUnauthorized) {
        setAuthBlocked(true);
      }
    }
  }, [authBlocked, ensureSession, isDemoRoute, outOfPolicy, requiredTier, walletAddress]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    onStateChange(state);
  }, [onStateChange, state]);

  useEffect(() => {
    if (state.status !== "pending_review" && state.status !== "approved_indexing") {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshStatus();
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [refreshStatus, state.status]);

  useEffect(() => {
    return () => {
      if (demoTimerRef.current !== null) {
        window.clearTimeout(demoTimerRef.current);
      }
    };
  }, []);

  const launchKyc = useCallback(async () => {
    if (!walletAddress || requiredTier === "NONE" || outOfPolicy) {
      return;
    }

    if (isDemoRoute) {
      if (demoTimerRef.current !== null) {
        window.clearTimeout(demoTimerRef.current);
      }

      setIsDemoModalOpen(true);
      setDemoStep("initializing");
      setIsLaunching(true);

      demoTimerRef.current = window.setTimeout(() => {
        setDemoStep("approved");
        setState({
          requiredTier,
          approvedTier: "FULL",
          status: "approved_ready",
          meetsRequirement: true,
          outOfPolicy: false,
          message: "Sandbox Mode: KYC Auto-Approved for Demo.",
        });
        setIsLaunching(false);
      }, 2_000);

      return;
    }

    setIsLaunching(true);
    try {
      await ensureSession();
      const response = await fetch("/api/kyc/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requiredTier,
        }),
      });
      const payload = (await response.json()) as { token?: string; error?: string };
      if (!response.ok || !payload.token) {
        throw new Error(payload.error ?? "Failed to create KYC access token.");
      }

      await ensureSumsubScript();
      const sdk = window.snsWebSdk;
      if (!sdk?.init) {
        throw new Error("Sumsub WebSDK is unavailable.");
      }

      const builder = sdk.init(payload.token, { lang: "en" });
      const configured =
        typeof builder.withConf === "function"
          ? builder.withConf({
              theme: "light",
              uiConf: { customCssStr: "" },
            })
          : builder;
      const launchable = configured as SumsubLaunchable;
      if (typeof launchable.on === "function") {
        launchable.on("idCheck.onApplicantSubmitted", () => {
          void refreshStatus();
        });
      }
      if (typeof launchable.build === "function") {
        const app = launchable.build();
        app.launch("#sumsub-websdk-container");
      } else if (typeof launchable.launch === "function") {
        launchable.launch("#sumsub-websdk-container");
      }

      setState((current) => ({
        ...current,
        status: "pending_review",
        meetsRequirement: false,
        message: "KYC is under review.",
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start KYC.";
      const isUnauthorized =
        message.toLowerCase().includes("unauthorized") ||
        message.toLowerCase().includes("wallet session");
      if (isUnauthorized) {
        setAuthBlocked(true);
      }
      setState((current) => ({
        ...current,
        message,
      }));
    } finally {
      setIsLaunching(false);
    }
  }, [ensureSession, isDemoRoute, outOfPolicy, refreshStatus, requiredTier, walletAddress]);

  if (!walletAddress || requiredTier === "NONE") {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-4",
        state.meetsRequirement
          ? "border-[var(--green-border)] bg-[var(--green-soft)]"
          : "border-[color:var(--border-light)] bg-[var(--bg-card)]/80",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-9 w-9 items-center justify-center rounded-full",
            state.meetsRequirement ? "bg-[var(--green)]/20 text-[var(--green-strong)]" : "bg-[var(--warning-bg)] text-[var(--warning-fg)]",
          )}
        >
          {state.meetsRequirement ? <CheckCircle2 className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--text-3)]">
              Compliance gate
            </p>
            <span className="rounded-full bg-[var(--bg-page)] px-2.5 py-1 text-[11px] font-[var(--font-mono)] text-[var(--text-2)]">
              Tier {requiredTier}
            </span>
          </div>
          <p className="mt-2 text-[13px] leading-6 text-[var(--text-2)]">
            Required by RBI FEMA guidelines for INR settlements above ₹50,000. Your documents are
            verified by Sumsub - they never touch the blockchain.
          </p>
          <p className="mt-2 text-[13px] leading-6 text-[var(--text-2)]">
            {state.message}
          </p>
          {state.status === "approved_indexing" ? (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-[var(--text-2)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Minting on-chain compliance proof...
            </div>
          ) : null}
          {!state.meetsRequirement ? (
            <button
              type="button"
              onClick={() => void launchKyc()}
              disabled={isLaunching || outOfPolicy}
              className="btn-primary btn-accent mt-4 rounded-lg"
            >
              {isLaunching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {state.status === "pending_review" ? "Resume verification" : "Complete KYC"}
            </button>
          ) : null}
          {outOfPolicy ? (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-[var(--danger-fg)]">
              <AlertCircle className="h-3.5 w-3.5" />
              Settlements above INR 5,00,000 are disabled in this MVP.
            </div>
          ) : null}
        </div>
      </div>
      <div id="sumsub-websdk-container" className="mt-4" />

      {isDemoModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Close KYC dialog"
            className="absolute inset-0 bg-black/45 backdrop-blur-sm"
            onClick={() => {
              if (demoStep === "approved") {
                setIsDemoModalOpen(false);
              }
            }}
          />
          <div className="surface-card relative z-10 w-full max-w-md rounded-3xl border border-[var(--border)] p-6 shadow-[var(--shadow-panel)]">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-2xl",
                  demoStep === "approved"
                    ? "bg-[var(--green-soft)] text-[var(--green-strong)]"
                    : "bg-[var(--surface-card-soft)] text-[var(--text-2)]",
                )}
              >
                {demoStep === "approved" ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin" />
                )}
              </div>
              <div>
                <p className="text-[11px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                  Demo compliance
                </p>
                <h3 className="mt-1 font-[var(--font-syne)] text-2xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
                  {demoStep === "approved" ? "Compliance ready." : "Initializing Compliance Engine..."}
                </h3>
              </div>
            </div>

            <p className="mt-4 text-[14px] leading-6 text-[var(--text-2)]">
              {demoStep === "approved"
                ? "Sandbox Mode: KYC Auto-Approved for Demo. Settlement controls are now unlocked for the showcase flow."
                : "Preparing a simulated Sumsub session and auto-approving the required tier so the demo can continue smoothly."}
            </p>

            <div className="mt-6 flex justify-end">
              {demoStep === "approved" ? (
                <button
                  type="button"
                  onClick={() => setIsDemoModalOpen(false)}
                  className="btn-primary rounded-lg"
                >
                  Continue
                </button>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-card-soft)] px-4 py-2 text-[12px] text-[var(--text-2)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Connecting sandbox verifier
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
