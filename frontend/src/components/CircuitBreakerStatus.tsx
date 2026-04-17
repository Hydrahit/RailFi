"use client";

import { Buffer } from "buffer";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ShieldCheck, TimerReset } from "lucide-react";
import { Program, AnchorProvider, type Idl } from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import rawIdl from "@/idl/railpay.json";
import { CircuitBreakerSkeleton } from "@/components/ui/AppSkeletons";
import { StatusPill } from "@/components/ui/StatusPill";

interface CircuitBreakerState {
  isTripped: boolean;
  outflowThisWindow: number;
  maxOutflowPerWindow: number;
  windowStart: number;
  windowDurationSeconds: number;
  tripCount: number;
}

type CircuitBreakerStatusState = "loading" | "ready" | "uninitialized";

const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID!);
const ADMIN_AUTHORITY = process.env.NEXT_PUBLIC_ADMIN_PUBKEY
  ? new PublicKey(process.env.NEXT_PUBLIC_ADMIN_PUBKEY)
  : null;
const CIRCUIT_BREAKER_SEEDS = [Buffer.from("circuit_breaker")];
const PROTOCOL_CONFIG_SEEDS = [Buffer.from("protocol_config_v2")];

export function CircuitBreakerStatus() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signTransaction, signAllTransactions } = useWallet();
  const [status, setStatus] = useState<CircuitBreakerStatusState>("loading");
  const [state, setState] = useState<CircuitBreakerState | null>(null);
  const [secondsUntilReset, setSecondsUntilReset] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = !!publicKey && !!ADMIN_AUTHORITY && publicKey.equals(ADMIN_AUTHORITY);
  const minutes = Math.floor(secondsUntilReset / 60);
  const seconds = secondsUntilReset % 60;

  const program = useMemo(() => {
    if (!publicKey || !signTransaction || !signAllTransactions) {
      return null;
    }

    const provider = new AnchorProvider(
      connection,
      { publicKey, signTransaction, signAllTransactions },
      { commitment: "confirmed" },
    );

    return new Program(rawIdl as Idl, PROGRAM_ID, provider);
  }, [connection, publicKey, signAllTransactions, signTransaction]);

  const fetchState = useCallback(async () => {
    try {
      const [circuitBreakerPda] = PublicKey.findProgramAddressSync(CIRCUIT_BREAKER_SEEDS, PROGRAM_ID);
      const accountInfo = await connection.getAccountInfo(circuitBreakerPda, "confirmed");

      if (accountInfo === null) {
        setStatus("uninitialized");
        setState(null);
        setSecondsUntilReset(0);
        setError(null);
        return;
      }

      const data = accountInfo.data;
      const maxOutflow = Number(data.readBigUInt64LE(40)) / 1e6;
      const windowDuration = Number(data.readBigInt64LE(48));
      const windowStart = Number(data.readBigInt64LE(56));
      const outflow = Number(data.readBigUInt64LE(64)) / 1e6;
      const isTripped = data[72] === 1;
      const tripCount = Number(data.readBigUInt64LE(73));

      setState({
        isTripped,
        outflowThisWindow: outflow,
        maxOutflowPerWindow: maxOutflow,
        windowStart,
        windowDurationSeconds: windowDuration,
        tripCount,
      });

      const now = Math.floor(Date.now() / 1000);
      setSecondsUntilReset(Math.max(0, windowStart + windowDuration - now));
      setStatus("ready");
      setError(null);
    } catch {
      setError("Failed to fetch circuit breaker state");
      setStatus("ready");
    }
  }, [connection]);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  useEffect(() => {
    if (status !== "ready" || !state) {
      return;
    }

    const tick = window.setInterval(() => {
      setSecondsUntilReset((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(tick);
  }, [state, status]);

  const sendInstruction = useCallback(
    async (instructionName: "initializeCircuitBreaker" | "adminResetCircuitBreaker") => {
      if (!publicKey || !sendTransaction || !program) {
        return;
      }

      setIsSubmitting(true);
      setError(null);

      try {
        const [circuitBreakerPda] = PublicKey.findProgramAddressSync(CIRCUIT_BREAKER_SEEDS, PROGRAM_ID);
        const [protocolConfigPda] = PublicKey.findProgramAddressSync(PROTOCOL_CONFIG_SEEDS, PROGRAM_ID);

        const builder =
          instructionName === "initializeCircuitBreaker"
            ? program.methods.initializeCircuitBreaker().accounts({
                admin: publicKey,
                protocolConfig: protocolConfigPda,
                circuitBreaker: circuitBreakerPda,
                systemProgram: SystemProgram.programId,
              })
            : program.methods.adminResetCircuitBreaker().accounts({
                admin: publicKey,
                protocolConfig: protocolConfigPda,
                circuitBreaker: circuitBreakerPda,
              });

        const instruction = await builder.instruction();
        const latestBlockhash = await connection.getLatestBlockhash("confirmed");
        const transaction = new Transaction({
          feePayer: publicKey,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        }).add(instruction);

        const signature = await sendTransaction(transaction, connection, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });

        await connection.confirmTransaction(
          {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          "confirmed",
        );

        await fetchState();
      } catch (submitError: unknown) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Failed to submit circuit breaker transaction",
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [connection, fetchState, program, publicKey, sendTransaction],
  );

  if (status === "loading") {
    return <CircuitBreakerSkeleton />;
  }

  if (status === "uninitialized") {
    return (
      <section className="metric-panel p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <StatusPill tone="warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                Not initialized
              </StatusPill>
            </div>
            <h2 className="mt-3 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
              Circuit-breaker safety controls are offline.
            </h2>
            <p className="mt-2 max-w-xl text-[14px] leading-6 text-[var(--text-2)]">
              The vault protection layer has not been initialized on-chain yet. Admin setup is required
              before RailFi can present a live guarded status.
            </p>
          </div>
          {isAdmin ? (
            <button
              onClick={() => void sendInstruction("initializeCircuitBreaker")}
              disabled={isSubmitting}
              className="btn-primary active:scale-[0.99] sm:w-auto sm:px-6"
            >
              {isSubmitting ? "Sending transaction..." : "Initialize circuit breaker"}
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-3 text-[12px] text-[var(--danger-fg)]">{error}</p> : null}
      </section>
    );
  }

  if (!state) {
    return null;
  }

  const usagePct = Math.min(
    100,
    (state.outflowThisWindow / Math.max(state.maxOutflowPerWindow, 1)) * 100,
  );

  return (
    <section className={state.isTripped ? "metric-panel p-5" : "metric-panel-dark p-5"}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={state.isTripped ? "warning" : "success"}>
              {state.isTripped ? <AlertTriangle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {state.isTripped ? "Paused" : "Operational"}
            </StatusPill>
            <StatusPill tone={state.isTripped ? "neutral" : "darkSoft"}>
              Trips: {state.tripCount}
            </StatusPill>
          </div>
          <h2
            className={`mt-3 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em] ${
              state.isTripped ? "text-[var(--text-1)]" : "text-heavy-primary"
            }`}
          >
            {state.isTripped ? "Outflow protection is currently engaged." : "Settlement safety rail is healthy."}
          </h2>
          <p className={`mt-2 max-w-xl text-[14px] leading-6 ${state.isTripped ? "text-[var(--text-2)]" : "text-heavy-secondary"}`}>
            Current window usage is monitored automatically. If payout demand breaches policy, the
            breaker trips before further offramp execution can continue.
          </p>
        </div>

        <div
          className={`rounded-[24px] p-4 ${
            state.isTripped ? "bg-[var(--surface-card-soft)]" : "surface-heavy-elevated"
          }`}
        >
          <p className={`text-[10px] font-[var(--font-mono)] uppercase tracking-[0.2em] ${state.isTripped ? "text-[var(--text-3)]" : "text-heavy-muted"}`}>
            Reset window
          </p>
          <div className={`mt-2 flex items-center gap-2 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em] ${state.isTripped ? "text-[var(--text-1)]" : "text-heavy-primary"}`}>
            <TimerReset className="h-5 w-5" />
            {minutes}m {seconds}s
          </div>
        </div>
      </div>

      <div
        className={`mt-5 rounded-[24px] p-4 ${
          state.isTripped ? "bg-black/5" : "surface-heavy-soft"
        }`}
      >
        <div className={`mb-2 flex items-center justify-between text-[12px] ${state.isTripped ? "text-[var(--text-2)]" : "text-heavy-secondary"}`}>
          <span>Window outflow</span>
          <span>
            {state.outflowThisWindow.toFixed(2)} / {state.maxOutflowPerWindow.toLocaleString()} USDC
          </span>
        </div>
        <div
          className={`h-3 overflow-hidden rounded-full ${
            state.isTripped ? "bg-black/6" : "bg-[var(--surface-heavy-elevated)]"
          }`}
        >
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              state.isTripped ? "bg-[var(--warning-fg)]" : "bg-[var(--green)]"
            }`}
            style={{ width: `${usagePct}%` }}
          />
        </div>
      </div>

      {isAdmin && state.isTripped ? (
        <button
          onClick={() => void sendInstruction("adminResetCircuitBreaker")}
          disabled={isSubmitting}
          className="btn-primary mt-5 active:scale-[0.99] sm:w-auto sm:px-6"
        >
          {isSubmitting ? "Sending transaction..." : "Reset circuit breaker"}
        </button>
      ) : null}

      {error ? <p className="mt-3 text-[12px] text-[var(--danger-fg)]">{error}</p> : null}
    </section>
  );
}
