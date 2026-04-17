"use client";

import { Buffer } from "buffer";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Copy, Loader2, Share2, Users } from "lucide-react";
import rawIdl from "@/idl/railpay.json";
import { useToast } from "@/hooks/useToast";
import { PROGRAM_ID } from "@/lib/solana";
import { deriveReferralConfigPda, fetchReferralConfig, type ReferralConfigAccount } from "@/lib/referrals";

const idl = rawIdl as Idl;
const globalWithBuffer = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
globalWithBuffer.Buffer ??= Buffer;

export function ReferralDashboard() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const { showToast } = useToast();
  const [referralConfig, setReferralConfig] = useState<ReferralConfigAccount | null>(null);
  const [feeBps, setFeeBps] = useState("500");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  const referralLink = useMemo(() => {
    if (!publicKey || typeof window === "undefined") {
      return "";
    }
    return `${window.location.origin}/transfer?ref=${publicKey.toBase58()}`;
  }, [publicKey]);

  const refreshReferralConfig = useCallback(async () => {
    if (!publicKey) {
      setReferralConfig(null);
      return;
    }

    setIsLoading(true);
    try {
      const record = await fetchReferralConfig(connection, publicKey);
      setReferralConfig(record);
    } catch {
      setReferralConfig(null);
    } finally {
      setIsLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void refreshReferralConfig();
  }, [refreshReferralConfig]);

  async function handleInitializeReferral() {
    if (!publicKey || !signTransaction || !signAllTransactions || isCreating) {
      return;
    }

    const parsedFeeBps = Number(feeBps);
    if (!Number.isInteger(parsedFeeBps) || parsedFeeBps < 1 || parsedFeeBps > 5_000) {
      showToast("Fee share must be between 1 and 5000 bps.", "error");
      return;
    }

    setIsCreating(true);
    try {
      const provider = new AnchorProvider(
        connection,
        { publicKey, signTransaction, signAllTransactions },
        { commitment: "confirmed" },
      );
      const program = new Program(idl, PROGRAM_ID, provider);
      const [referralConfigPda] = deriveReferralConfigPda(publicKey);

      await program.methods
        .initializeReferral(parsedFeeBps)
        .accounts({
          referrer: publicKey,
          referralConfig: referralConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      showToast("Referral link is ready.", "success");
      await refreshReferralConfig();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to initialize referral.", "error");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCopyLink() {
    if (!referralLink || isCopying) {
      return;
    }

    setIsCopying(true);
    try {
      await navigator.clipboard.writeText(referralLink);
      showToast("Referral link copied", "success");
    } catch {
      showToast("Unable to copy referral link.", "error");
    } finally {
      setIsCopying(false);
    }
  }

  return (
    <section className="section-shell content-card animate-in rounded-2xl p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Referrals
          </p>
          <h2 className="mt-2 font-[var(--font-syne)] text-2xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
            Invite wallets and earn from protocol flow.
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--text-2)]">
            Share your `?ref=` link. Referred transfers pay the standard 1.00% protocol fee on top of the payout, and your reward is a configurable share of that fee.
          </p>
        </div>
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-[var(--text-3)]" /> : null}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <article className="metric-panel rounded-2xl p-4">
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Fee share
          </p>
          <p className="mt-3 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
            {referralConfig ? `${(referralConfig.feeBps / 100).toFixed(2)}%` : "Not set"}
          </p>
          <p className="mt-2 text-[12px] text-[var(--text-2)]">Of the protocol fee, not the payout principal</p>
        </article>

        <article className="metric-panel-dark dark-card rounded-2xl p-4">
          <p className="text-heavy-muted text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em]">
            Earned
          </p>
          <p className="text-heavy-primary mt-3 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em]">
            {referralConfig ? `${referralConfig.totalEarnedUsdc.toFixed(4)} USDC` : "0.0000 USDC"}
          </p>
          <p className="text-heavy-secondary mt-2 text-[12px]">Lifetime referral rewards paid from on-chain vault flow</p>
        </article>

        <article className="metric-panel rounded-2xl p-4">
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Referred payouts
          </p>
          <p className="mt-3 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
            {referralConfig?.totalReferred ?? 0}
          </p>
          <p className="mt-2 flex items-center gap-2 text-[12px] text-[var(--text-2)]">
            <Users className="h-3.5 w-3.5" />
            Completed referral-triggered offramp requests
          </p>
        </article>
      </div>

      {referralConfig ? (
        <div className="mt-5 rounded-2xl border border-black/10 bg-[var(--surface-muted)] px-4 py-4">
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Shareable link
          </p>
          <p className="mt-2 break-all text-[13px] text-[var(--text-2)]">{referralLink}</p>
          <button
            type="button"
            onClick={() => void handleCopyLink()}
            disabled={!referralLink || isCopying}
            className="btn-ghost mt-4 rounded-lg"
          >
            {isCopying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            {isCopying ? "Copying..." : "Copy referral link"}
          </button>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-black/10 bg-[var(--surface-muted)] px-4 py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-xl">
              <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                Activate
              </p>
              <p className="mt-2 text-[13px] leading-6 text-[var(--text-2)]">
                Initialize your referral profile once, choose the share you want from the protocol fee, and RailFi will generate a reusable `?ref=` link.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:min-w-[220px]">
              <input
                type="number"
                min="1"
                max="5000"
                step="1"
                value={feeBps}
                onChange={(event) => setFeeBps(event.target.value)}
                className="rp-input"
                placeholder="500"
                disabled={isCreating}
              />
              <button
                type="button"
                onClick={() => void handleInitializeReferral()}
                disabled={isCreating || !publicKey}
                className="btn-primary btn-accent rounded-lg"
              >
                {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                {isCreating ? "Initializing..." : "Initialize referral"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

