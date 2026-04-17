"use client";
import { useMemo, type ComponentType, type PropsWithChildren, type ReactNode } from "react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import {
  ConnectionProvider,
  WalletProvider,
  type ConnectionProviderProps,
  type WalletProviderProps,
} from "@solana/wallet-adapter-react";
import {
  WalletModalProvider,
  type WalletModalProviderProps,
} from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HybridAuthBridge } from "@/components/auth/HybridAuthBridge";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { WalletSessionProvider } from "@/components/WalletSessionProvider";
import { RailpayProvider } from "@/providers/RailpayProvider";
import "@solana/wallet-adapter-react-ui/styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

const SolanaConnectionProvider =
  ConnectionProvider as unknown as ComponentType<PropsWithChildren<ConnectionProviderProps>>;
const SolanaWalletProvider =
  WalletProvider as unknown as ComponentType<PropsWithChildren<WalletProviderProps>>;
const SolanaWalletModalProvider =
  WalletModalProvider as unknown as ComponentType<PropsWithChildren<WalletModalProviderProps>>;

export function Providers({ children }: { children: ReactNode }) {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl(network),
    [network],
  );
  const wallets = useMemo(() => [], []);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SolanaConnectionProvider endpoint={endpoint}>
          <SolanaWalletProvider wallets={wallets} autoConnect>
            <SolanaWalletModalProvider>
              <WalletSessionProvider>
                <HybridAuthBridge />
                <RailpayProvider>{children}</RailpayProvider>
              </WalletSessionProvider>
            </SolanaWalletModalProvider>
          </SolanaWalletProvider>
        </SolanaConnectionProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
