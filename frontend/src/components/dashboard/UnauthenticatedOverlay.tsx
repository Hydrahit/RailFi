"use client";

import Link from "next/link";
import { ClientWalletMultiButton } from "@/components/ClientWalletMultiButton";

interface UnauthenticatedOverlayProps {
  isAuthenticated: boolean;
  children: React.ReactNode;
}

export function UnauthenticatedOverlay({
  isAuthenticated,
  children,
}: UnauthenticatedOverlayProps) {
  if (isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="relative min-h-full w-full">
      <div
        className="pointer-events-none select-none"
        aria-hidden="true"
        style={{ filter: "blur(4px)", opacity: 0.45 }}
      >
        {children}
      </div>

      <div className="absolute inset-0 flex items-start justify-center pt-[15vh]">
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

        <div className="relative z-10 mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_32px_80px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-white/30 to-transparent" />

          <div className="px-8 py-10 text-center">
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-white/5 shadow-inner">
              <svg
                width="26"
                height="26"
                viewBox="0 0 26 26"
                fill="none"
                aria-hidden
              >
                <path
                  d="M13 2L3 7V13C3 18.5 7.5 23.7 13 25C18.5 23.7 23 18.5 23 13V7L13 2Z"
                  stroke="rgba(255,255,255,0.6)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M9 13L12 16L17 10"
                  stroke="rgba(255,255,255,0.8)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <h2 className="mb-2 text-xl font-semibold text-white">
              Connect wallet to continue
            </h2>

            <p className="mb-8 text-sm leading-relaxed text-white/70">
              Your vault, offramp history, and tax exports are waiting.
              <br />
              Or{" "}
              <Link
                href="/demo"
                className="text-white/85 underline decoration-white/40 underline-offset-2 transition-colors hover:text-white hover:decoration-white/70"
              >
                try the live demo
              </Link>{" "}
              — no wallet needed.
            </p>

            <WalletConnectTrigger />

            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-xs text-white/45">or</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <Link
              href="/demo"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 py-3 text-sm font-medium text-white/85 transition-all hover:border-white/30 hover:bg-white/15 hover:text-white"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-400" />
              </span>
              Explore transfer flow without a wallet
            </Link>
          </div>

          <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>
      </div>
    </div>
  );
}

function WalletConnectTrigger() {
  return (
    <div className="flex justify-center [&>button]:w-full [&>button]:rounded-xl [&>button]:py-3 [&>button]:text-sm [&>button]:font-semibold">
      <ClientWalletMultiButton />
    </div>
  );
}
