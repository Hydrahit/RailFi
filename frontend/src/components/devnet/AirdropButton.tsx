"use client";

import { useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useToast } from "@/hooks/useToast";

interface AirdropButtonProps {
  onSuccess?: () => void;
}

type AirdropState = "idle" | "loading" | "success" | "error";

export function AirdropButton({ onSuccess }: AirdropButtonProps) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { showToast } = useToast();
  const [state, setState] = useState<AirdropState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isDevnet =
    process.env.NEXT_PUBLIC_SOLANA_NETWORK === "devnet" ||
    process.env.NEXT_PUBLIC_SOLANA_NETWORK === undefined;

  const handleAirdrop = useCallback(async () => {
    if (!publicKey || state === "loading") return;

    setState("loading");
    setErrorMsg(null);

    try {
      const signature = await connection.requestAirdrop(
        publicKey,
        1 * LAMPORTS_PER_SOL,
      );

      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed",
      );

      setState("success");
      onSuccess?.();
      showToast("Airdrop confirmed - 1 Devnet SOL added", "success");

      setTimeout(() => setState("idle"), 3000);
    } catch (err) {
      console.error("[AirdropButton] Airdrop failed:", err);
      const msg =
        err instanceof Error && err.message.includes("airdrop limit")
          ? "Faucet limit reached. Try again in 24h."
          : "Airdrop failed. Devnet faucet may be busy.";
      setErrorMsg(msg);
      setState("error");
      showToast(msg, "error");
      setTimeout(() => {
        setState("idle");
        setErrorMsg(null);
      }, 4000);
    }
  }, [publicKey, connection, state, onSuccess, showToast]);

  if (!isDevnet || !publicKey) return null;

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={handleAirdrop}
        disabled={state === "loading" || state === "success"}
        className={[
          "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-200",
          "border-amber-500/30 bg-amber-500/5 text-amber-600",
          "hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-500",
          "disabled:cursor-not-allowed disabled:opacity-50",
          state === "success" &&
            "border-green-500/30 bg-green-500/5 text-green-500 hover:bg-green-500/5",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label="Request 1 devnet SOL airdrop"
        type="button"
      >
        {state === "loading" && (
          <svg
            className="h-3 w-3 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}

        {state === "success" && (
          <svg
            className="h-3 w-3"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden
          >
            <path
              d="M2 6l3 3 5-5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {(state === "idle" || state === "error") && (
          <svg
            className="h-3 w-3"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden
          >
            <path
              d="M6 1v4M4 3h4M5 5c0 1.5-2 2.5-2 4a3 3 0 006 0c0-1.5-2-2.5-2-4"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        )}

        {state === "idle" && "Airdrop Devnet SOL"}
        {state === "loading" && "Requesting..."}
        {state === "success" && "1 SOL received!"}
        {state === "error" && "Try again"}
      </button>

      {state === "error" && errorMsg && (
        <p className="text-[10px] text-red-400/70">{errorMsg}</p>
      )}
    </div>
  );
}
