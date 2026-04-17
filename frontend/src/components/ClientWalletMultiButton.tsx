"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  {
    ssr: false,
    loading: () => (
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-card-soft)] px-5 py-2.5 text-sm font-[var(--font-syne)] text-[var(--text-secondary)] opacity-80 shadow-[0_12px_24px_rgba(10,10,10,0.1)]"
        disabled
      >
        Connect Wallet
      </button>
    ),
  },
);

export function ClientWalletMultiButton() {
  const [mounted, setMounted] = useState(false);
  const { connected } = useWallet();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="relative z-[100] flex items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-card-soft)] px-5 py-2.5 text-sm font-[var(--font-syne)] text-[var(--text-secondary)] opacity-80 shadow-[0_12px_24px_rgba(10,10,10,0.1)]"
          disabled
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="relative z-[100] flex items-center gap-2">
      {connected ? (
        <span className="hidden text-xs text-current/40 sm:inline">Wallet&nbsp;</span>
      ) : null}
      <WalletMultiButton />
    </div>
  );
}
