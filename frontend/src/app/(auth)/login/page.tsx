"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { ShieldCheck, Sparkles } from "lucide-react";
import { ClientWalletMultiButton } from "@/components/ClientWalletMultiButton";
import { StatusPill } from "@/components/ui/StatusPill";

export default function LoginPage() {
  const { connected } = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (connected) {
      router.replace("/dashboard");
    }
  }, [connected, router]);

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
            Connect your wallet.
          </h1>
          <p className="mt-3 max-w-lg text-[15px] leading-7 text-[var(--text-2)]">
            Use Phantom, Backpack, or any wallet-standard compatible client to enter the RailFi
            settlement rail.
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

            <div className="flex justify-start">
              <ClientWalletMultiButton />
            </div>
          </div>

          <p className="mt-6 text-[12px] text-[var(--text-3)]">
            Devnet only. No custody. No private key storage.
          </p>
        </section>
      </div>
    </main>
  );
}
