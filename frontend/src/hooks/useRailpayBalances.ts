"use client";

import { useCallback, useEffect, useState } from "react";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { LAMPORTS_PER_SOL, type Connection, type PublicKey } from "@solana/web3.js";
import { CONFIGURED_USDC_MINT } from "@/lib/solana";
import type { WalletBalances } from "@/types/railpay";

interface UseRailpayBalancesParams {
  connection: Connection;
  publicKey: PublicKey | null;
  usdcMint: PublicKey | null;
}

interface UseRailpayBalancesReturn {
  balances: WalletBalances;
  hasLoadedBalances: boolean;
  refreshBalances: () => Promise<void>;
}

export function useRailpayBalances({
  connection,
  publicKey,
  usdcMint,
}: UseRailpayBalancesParams): UseRailpayBalancesReturn {
  const [balances, setBalances] = useState<WalletBalances>({
    sol: 0,
    usdc: 0,
    isLoading: false,
  });
  const [hasLoadedBalances, setHasLoadedBalances] = useState(false);

  const refreshBalances = useCallback(async () => {
    if (!publicKey) {
      setBalances({ sol: 0, usdc: 0, isLoading: false });
      setHasLoadedBalances(false);
      return;
    }

    setBalances((prev) => ({ ...prev, isLoading: true }));

    try {
      const sol = (await connection.getBalance(publicKey)) / LAMPORTS_PER_SOL;
      let usdc = 0;

      try {
        const userAta = await getAssociatedTokenAddress(
          usdcMint ?? CONFIGURED_USDC_MINT,
          publicKey,
        );
        const balance = await connection.getTokenAccountBalance(userAta);
        usdc = balance.value.uiAmount ?? 0;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown wallet USDC balance error.";
        console.warn("[useRailpayBalances] USDC balance refresh failed:", message);
      }

      setBalances({ sol, usdc, isLoading: false });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown balance refresh error.";
      console.warn("[useRailpayBalances] Balance refresh failed:", message);
      setBalances((prev) => ({ ...prev, isLoading: false }));
    } finally {
      setHasLoadedBalances(true);
    }
  }, [connection, publicKey, usdcMint]);

  useEffect(() => {
    if (!publicKey) {
      setBalances({ sol: 0, usdc: 0, isLoading: false });
      setHasLoadedBalances(false);
      return;
    }

    setHasLoadedBalances(false);
    void refreshBalances();
  }, [publicKey, refreshBalances]);

  return {
    balances,
    hasLoadedBalances,
    refreshBalances,
  };
}
