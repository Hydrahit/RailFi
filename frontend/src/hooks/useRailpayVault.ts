"use client";

import { useCallback, useEffect, useState } from "react";
import { BN, type Idl, type Program } from "@coral-xyz/anchor";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import type { Connection, PublicKey } from "@solana/web3.js";
import { CONFIGURED_USDC_MINT, USDC_DECIMALS } from "@/lib/solana";
import type { VaultDisplay } from "@/types/railpay";

interface UserVaultAccountData {
  isActive: boolean;
  upiHandleHash: number[];
  totalReceived: BN;
  totalOfframped: BN;
  receiptCount: number;
  bump: number;
}

interface UseRailpayVaultParams {
  connection: Connection;
  vaultPda: PublicKey | null;
  usdcMint: PublicKey | null;
  getProgram: () => Program<Idl> | null;
}

interface UseRailpayVaultReturn {
  vault: VaultDisplay | null;
  isVaultLoading: boolean;
  hasLoadedVault: boolean;
  refreshVault: () => Promise<void>;
  setVault: React.Dispatch<React.SetStateAction<VaultDisplay | null>>;
}

export function useRailpayVault({
  connection,
  vaultPda,
  usdcMint,
  getProgram,
}: UseRailpayVaultParams): UseRailpayVaultReturn {
  const [vault, setVault] = useState<VaultDisplay | null>(null);
  const [isVaultLoading, setIsVaultLoading] = useState(false);
  const [hasLoadedVault, setHasLoadedVault] = useState(false);

  const refreshVault = useCallback(async () => {
    if (!vaultPda) {
      setVault(null);
      setIsVaultLoading(false);
      setHasLoadedVault(false);
      return;
    }

    const program = getProgram();
    if (!program) {
      setIsVaultLoading(false);
      setHasLoadedVault(true);
      return;
    }

    setIsVaultLoading(true);

    try {
      const fetchedVault = (await program.account.userVault.fetch(
        vaultPda,
      )) as unknown as UserVaultAccountData;

      const totalReceived = Number(fetchedVault.totalReceived) / 10 ** USDC_DECIMALS;
      const totalOfframped = Number(fetchedVault.totalOfframped) / 10 ** USDC_DECIMALS;
      const availableUsdc = Math.max(totalReceived - totalOfframped, 0);

      let escrowUsdc = 0;
      try {
        const vaultAta = await getAssociatedTokenAddress(
          usdcMint ?? CONFIGURED_USDC_MINT,
          vaultPda,
          true,
        );
        const vaultBalance = await connection.getTokenAccountBalance(vaultAta);
        escrowUsdc = vaultBalance.value.uiAmount ?? 0;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown vault escrow balance error.";
        console.warn("[useRailpayVault] Vault escrow balance refresh failed:", message);
      }

      setVault({
        isInitialized: true,
        isActive: fetchedVault.isActive,
        upiHandle: "Private route locked",
        totalReceived,
        totalOfframped,
        availableUsdc,
        escrowUsdc,
        receiptCount: fetchedVault.receiptCount,
        bump: fetchedVault.bump,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown vault refresh error.";
      console.warn("[useRailpayVault] Vault refresh failed:", message);
      setVault(null);
    } finally {
      setIsVaultLoading(false);
      setHasLoadedVault(true);
    }
  }, [connection, getProgram, usdcMint, vaultPda]);

  useEffect(() => {
    if (!vaultPda) {
      setVault(null);
      setIsVaultLoading(false);
      setHasLoadedVault(false);
      return;
    }

    setHasLoadedVault(false);
    void refreshVault();
  }, [refreshVault, vaultPda]);

  return {
    vault,
    isVaultLoading,
    hasLoadedVault,
    refreshVault,
    setVault,
  };
}
