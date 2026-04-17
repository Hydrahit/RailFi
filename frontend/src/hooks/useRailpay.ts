"use client";

import { Buffer } from "buffer";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, setProvider, type Idl } from "@coral-xyz/anchor";
import rawIdl from "../idl/railpay.json";
import {
  PROGRAM_ID,
  VAULT_SEED,
  USDC_DECIMALS,
  deriveProtocolConfigPda,
} from "@/lib/solana";
import type {
  FundingPhase,
  OfframpPhase,
  ProtocolConfigDisplay,
  VaultDisplay,
  WalletBalances,
} from "@/types/railpay";
import { useRailpayProtocol } from "@/hooks/useRailpayProtocol";
import { useRailpayBalances } from "@/hooks/useRailpayBalances";
import { useRailpayVault } from "@/hooks/useRailpayVault";
import {
  useRailpayActions,
  type RailpayTxResult,
  type TriggerOfframpReferralInput,
} from "@/hooks/useRailpayActions";

const idl = rawIdl as Idl;
const globalWithBuffer = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
globalWithBuffer.Buffer ??= Buffer;

export type TxResult = RailpayTxResult;
export type { TriggerOfframpReferralInput } from "@/hooks/useRailpayActions";

export interface UseRailpayReturn {
  balances: WalletBalances;
  vault: VaultDisplay | null;
  protocolConfig: ProtocolConfigDisplay | null;
  protocolConfigError: string | null;
  vaultPda: PublicKey | null;
  refreshBalances: () => Promise<void>;
  refreshVault: () => Promise<void>;
  txPhase: OfframpPhase;
  txResult: TxResult | null;
  txError: string | null;
  depositPhase: FundingPhase;
  depositResult: TxResult | null;
  depositError: string | null;
  initializeVault: (upiId: string) => Promise<void>;
  depositUsdc: (amountUsdc: number) => Promise<void>;
  triggerOfframp: (
    amountUsdc: number,
    upiId: string,
    inrPaise: number,
    referral?: TriggerOfframpReferralInput | null,
  ) => Promise<void>;
  resetTx: () => void;
  resetDeposit: () => void;
  isReady: boolean;
  isProtocolReady: boolean;
  isProtocolConfigLoading: boolean;
  isVaultLoading: boolean;
  isBootstrapping: boolean;
  isInitialLoadComplete: boolean;
}

export function useRailpay(): UseRailpayReturn {
  const { connection } = useConnection();
  const { publicKey, signTransaction, signAllTransactions, sendTransaction, connected } =
    useWallet();
  const [vaultPda, setVaultPda] = useState<PublicKey | null>(null);

  const protocolConfigPda = useMemo(() => deriveProtocolConfigPda(PROGRAM_ID)[0], []);

  useEffect(() => {
    if (!publicKey) {
      setVaultPda(null);
      return;
    }

    const [pda] = PublicKey.findProgramAddressSync(
      [VAULT_SEED, publicKey.toBuffer()],
      PROGRAM_ID,
    );
    setVaultPda(pda);
  }, [publicKey]);

  const getProgram = useCallback((): Program<Idl> | null => {
    if (!publicKey || !signTransaction || !signAllTransactions) {
      return null;
    }

    const provider = new AnchorProvider(
      connection,
      { publicKey, signTransaction, signAllTransactions },
      { commitment: "confirmed" },
    );

    setProvider(provider);
    return new Program(idl, PROGRAM_ID, provider);
  }, [connection, publicKey, signAllTransactions, signTransaction]);

  const {
    protocolConfig,
    protocolConfigKeys,
    protocolConfigError,
    isProtocolConfigLoading,
    hasLoadedProtocolConfig,
    refreshProtocolConfig,
  } = useRailpayProtocol({
    connection,
    protocolConfigPda,
  });

  const { balances, hasLoadedBalances, refreshBalances } = useRailpayBalances({
    connection,
    publicKey,
    usdcMint: protocolConfigKeys?.usdcMint ?? null,
  });

  const { vault, isVaultLoading, hasLoadedVault, refreshVault } = useRailpayVault({
    connection,
    vaultPda,
    usdcMint: protocolConfigKeys?.usdcMint ?? null,
    getProgram,
  });

  const {
    txPhase,
    txResult,
    txError,
    depositPhase,
    depositResult,
    depositError,
    initializeVault,
    depositUsdc,
    triggerOfframp,
    resetTx,
    resetDeposit,
  } = useRailpayActions({
    connection,
    publicKey,
    signTransaction,
    sendTransaction,
    getProgram,
    protocolConfigPda,
    protocolConfigKeys,
    vaultPda,
    vault,
    refreshBalances,
    refreshVault,
    refreshProtocolConfig,
    usdcDecimals: USDC_DECIMALS,
  });

  const isInitialLoadComplete =
    !connected || !publicKey || (hasLoadedProtocolConfig && hasLoadedBalances && hasLoadedVault);

  const isBootstrapping = connected && !!publicKey && !isInitialLoadComplete;

  return {
    balances,
    vault,
    protocolConfig,
    protocolConfigError,
    vaultPda,
    refreshBalances,
    refreshVault,
    txPhase,
    txResult,
    txError,
    depositPhase,
    depositResult,
    depositError,
    initializeVault,
    depositUsdc,
    triggerOfframp,
    resetTx,
    resetDeposit,
    isReady: connected && !!publicKey,
    isProtocolReady: protocolConfigKeys !== null,
    isProtocolConfigLoading,
    isVaultLoading,
    isBootstrapping,
    isInitialLoadComplete,
  };
}
