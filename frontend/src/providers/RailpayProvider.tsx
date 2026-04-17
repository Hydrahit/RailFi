"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRailpay, type UseRailpayReturn } from "@/hooks/useRailpay";

const RailpayContext = createContext<UseRailpayReturn | null>(null);

export function RailpayProvider({ children }: { children: ReactNode }) {
  const railpay = useRailpay();
  const {
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
    isReady,
    isProtocolReady,
    isProtocolConfigLoading,
    isVaultLoading,
    isBootstrapping,
    isInitialLoadComplete,
  } = railpay;

  const value = useMemo<UseRailpayReturn>(
    () => ({
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
      isReady,
      isProtocolReady,
      isProtocolConfigLoading,
      isVaultLoading,
      isBootstrapping,
      isInitialLoadComplete,
    }),
    [
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
      isReady,
      isProtocolReady,
      isProtocolConfigLoading,
      isVaultLoading,
      isBootstrapping,
      isInitialLoadComplete,
    ],
  );

  return <RailpayContext.Provider value={value}>{children}</RailpayContext.Provider>;
}

export function useRailpayContext(): UseRailpayReturn {
  const context = useContext(RailpayContext);
  if (!context) {
    throw new Error("useRailpayContext must be used within a RailpayProvider.");
  }

  return context;
}
