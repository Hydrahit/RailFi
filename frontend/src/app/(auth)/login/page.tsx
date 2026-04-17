"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { CheckCircle2, Link2, ShieldCheck, Sparkles } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { ClientWalletMultiButton } from "@/components/ClientWalletMultiButton";
import { StatusPill } from "@/components/ui/StatusPill";
import { useHybridAuth } from "@/hooks/useHybridAuth";

export default function LoginPage() {
  const { connected } = useWallet();
  const router = useRouter();
  const { authState, isRefreshing } = useHybridAuth();
  const isReady =
    !!authState?.googleSessionActive &&
    !!authState?.walletSessionAuthenticated &&
    !!authState?.identityBound;

  useEffect(() => {
    if (isReady) {
      router.replace("/dashboard");
    }
  }, [isReady, router]);

  return (
    <main className="mesh-bg min-h-screen px-5 py-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center justify-center">
        <section className="surface-card w-full max-w-xl rounded-3xl p-7 sm:p-10">
          <div className="mb-5 flex items-center justify-between">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-heavy)] text-xl font-[var(--font-syne)] font-[800] text-[var(--text-inverted)]">
              RF
            </div>
            <StatusPill tone="neutral">
              <Sparkles className="h-3.5 w-3.5" />
              Devnet onboarding
            </StatusPill>
          </div>

          <h1 className="text-4xl font-[var(--font-syne)] font-[800] tracking-[-0.06em]">
            Finish your RailFi identity.
          </h1>
          <p className="mt-3 max-w-lg text-[15px] leading-7 text-[var(--text-2)]">
            RailFi now uses hybrid onboarding: a Google identity session plus a signed wallet
            session. You can start from either side and we will stitch them together.
          </p>

          <div className="mt-6 space-y-4">
            <div className="surface-card-dark rounded-2xl p-5">
              <div className="text-heavy-muted flex items-center gap-2 text-[11px] font-[var(--font-mono)] uppercase tracking-[0.2em]">
                <ShieldCheck className="h-4 w-4" />
                Non-custodial access
              </div>
              <p className="text-heavy-secondary mt-3 text-[14px] leading-6">
                Wallet signatures stay client-side. RailFi only orchestrates on-chain settlement
                instructions.
              </p>
            </div>

            <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-card-soft)] p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-[var(--font-mono)] uppercase tracking-[0.2em] text-[var(--text-3)]">
                  Google session
                </span>
                <StatusPill tone={authState?.googleSessionActive ? "success" : "neutral"}>
                  {isRefreshing ? "Checking" : authState?.googleSessionActive ? "Linked" : "Required"}
                </StatusPill>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-[var(--font-mono)] uppercase tracking-[0.2em] text-[var(--text-3)]">
                  Wallet session
                </span>
                <StatusPill tone={authState?.walletSessionAuthenticated ? "success" : "neutral"}>
                  {authState?.walletSessionAuthenticated
                    ? authState.walletAddress ?? "Ready"
                    : connected
                      ? "Sign required"
                      : "Required"}
                </StatusPill>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-[var(--font-mono)] uppercase tracking-[0.2em] text-[var(--text-3)]">
                  Hybrid link
                </span>
                <StatusPill tone={isReady ? "success" : "warning"}>
                  {isReady ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Ready
                    </>
                  ) : (
                    <>
                      <Link2 className="h-3.5 w-3.5" />
                      Partial
                    </>
                  )}
                </StatusPill>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex justify-start">
                <ClientWalletMultiButton />
              </div>
              <GoogleSignInButton
                callbackUrl="/dashboard"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-card-soft)] px-5 py-3 text-sm font-[var(--font-syne)] font-[700] text-[var(--text-1)]"
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-card)] text-[11px] font-[var(--font-mono)]">
                  G
                </span>
                Sign in with Google
              </GoogleSignInButton>
            </div>
          </div>

          <p className="mt-6 text-[12px] text-[var(--text-3)]">
            Devnet only. No custody. No private key storage. Complete both steps to unlock Dodo
            claim and payout flows.
          </p>
        </section>
      </div>
    </main>
  );
}
