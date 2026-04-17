"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { ArrowUpRight, ShieldCheck, Waves } from "lucide-react";
import { useRailpayContext } from "@/providers/RailpayProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { StatusPill } from "@/components/ui/StatusPill";
import { TransferComposerSkeleton } from "@/components/ui/AppSkeletons";
import { DodoPayoutPanel } from "@/features/offramp/components/DodoPayoutPanel";

export type DemoUiState =
  | "idle"
  | "offramp_pending"
  | "offramp_confirmed"
  | "payout_pending"
  | "payout_confirmed"
  | "csv_ready"
  | "error";

export interface DemoFlowState {
  state: DemoUiState;
  transferId: string | null;
  explorerUrl: string | null;
  utr: string | null;
  amountInr: string | null;
  csvUrl: string | null;
  error: string | null;
}

const INITIAL_DEMO_FLOW: DemoFlowState = {
  state: "idle",
  transferId: null,
  explorerUrl: null,
  utr: null,
  amountInr: null,
  csvUrl: null,
  error: null,
};

const OfframpForm = dynamic(
  () => import("@/features/offramp/components/OfframpForm").then((mod) => mod.OfframpForm),
  {
    ssr: false,
    loading: () => <TransferComposerSkeleton />,
  },
);

export function TransferScreen({ demoMode = false }: { demoMode?: boolean }) {
  const { refreshBalances, refreshVault } = useRailpayContext();
  const [animationSeed, setAnimationSeed] = useState(0);
  const [demoFlow, setDemoFlow] = useState<DemoFlowState>(INITIAL_DEMO_FLOW);

  const handleDemoOfframp = useCallback(
    async (input: { amountMicroUsdc: string; upiId: string; inrPaise: string }) => {
      setDemoFlow({
        ...INITIAL_DEMO_FLOW,
        state: "offramp_pending",
      });

      const response = await fetch("/api/demo/execute-offramp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-railfi-demo": "1",
        },
        body: JSON.stringify(input),
      });

      const payload = (await response.json()) as
        | { error?: string }
        | {
            transferId: string;
            state: DemoUiState;
            explorerUrl: string;
            amountInr: string;
          };

      if (!response.ok || !("transferId" in payload)) {
        throw new Error(("error" in payload && payload.error) || "Demo offramp failed.");
      }

      setDemoFlow({
        state: payload.state,
        transferId: payload.transferId,
        explorerUrl: payload.explorerUrl,
        utr: null,
        amountInr: payload.amountInr,
        csvUrl: null,
        error: null,
      });

      const poll = async () => {
        const statusResponse = await fetch(`/api/demo/payout-status/${payload.transferId}`, {
          cache: "no-store",
          headers: {
            "x-railfi-demo": "1",
          },
        });
        const statusPayload = (await statusResponse.json()) as
          | { error?: string }
          | {
              state: DemoUiState;
              utr: string | null;
              amountInr: string;
              explorerUrl: string;
            };

        if (!statusResponse.ok || !("state" in statusPayload)) {
          throw new Error(("error" in statusPayload && statusPayload.error) || "Demo status unavailable.");
        }

        setDemoFlow((current) => ({
          ...current,
          state: statusPayload.state,
          utr: statusPayload.utr,
          amountInr: statusPayload.amountInr,
          explorerUrl: statusPayload.explorerUrl,
          csvUrl:
            statusPayload.state === "payout_confirmed" || statusPayload.state === "csv_ready"
              ? `/api/demo/tax-csv?transferId=${payload.transferId}`
              : current.csvUrl,
          error: null,
        }));

        if (statusPayload.state === "payout_confirmed" || statusPayload.state === "csv_ready") {
          return;
        }

        window.setTimeout(() => {
          void poll().catch((error: unknown) => {
            setDemoFlow((current) => ({
              ...current,
              state: "error",
              error: error instanceof Error ? error.message : "Demo polling failed.",
            }));
          });
        }, 1500);
      };

      await poll();
    },
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Transfer"
        title="Compose a premium offramp."
        description="Fund your vault, validate the payout destination, preview the live rate, and move from USDC to UPI in one polished settlement flow."
        meta={
          <>
            <StatusPill tone="success">
              <ShieldCheck className="h-3.5 w-3.5" />
              Circuit-breaker protected
            </StatusPill>
            <StatusPill>
              <Waves className="h-3.5 w-3.5" />
              Pyth-backed quote flow
            </StatusPill>
          </>
        }
        actions={
          <RefreshButton
            onRefresh={() => Promise.all([refreshBalances(), refreshVault()]).then(() => undefined)}
            onSuccess={() => setAnimationSeed((current) => current + 1)}
          />
        }
      />

      <div className="mx-auto w-full max-w-7xl space-y-6">
        <OfframpForm
          animationSeed={animationSeed}
          demoMode={demoMode}
          demoFlow={demoFlow}
          onDemoOfframp={handleDemoOfframp}
          onDemoReset={() => setDemoFlow(INITIAL_DEMO_FLOW)}
          onDemoCsvReady={() =>
            setDemoFlow((current) =>
              current.transferId ? { ...current, state: "csv_ready" } : current,
            )
          }
        />

        <DodoPayoutPanel />

        <div className="section-shell rounded-2xl p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                Flow summary
              </p>
              <h3 className="mt-2 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
                Deposit, validate, lock, settle.
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill tone="dark">
                <ArrowUpRight className="h-3.5 w-3.5" />
                UPI destination checked
              </StatusPill>
              <StatusPill>Rate lock stored in OfframpRequest PDA</StatusPill>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
