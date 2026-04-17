"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { ExternalLink, Sparkles } from "lucide-react";
import { PROGRAM_ID } from "@/lib/solana";
import { cn } from "@/lib/utils";
import { ClientWalletMultiButton } from "@/components/ClientWalletMultiButton";
import { UnauthenticatedOverlay } from "@/components/dashboard/UnauthenticatedOverlay";
import { DASHBOARD_NAV, DashboardHeader } from "@/components/dashboard/DashboardHeader";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { connected } = useWallet();
  const pathname = usePathname();

  return (
    <div className="mesh-bg dark min-h-screen px-2.5 py-3 sm:px-4 sm:py-5">
      <div className="app-shell mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl overflow-visible rounded-3xl">
        <aside className="hidden w-[300px] shrink-0 overflow-visible border-r border-[var(--border)] bg-[var(--surface-muted)]/92 p-5 lg:flex lg:flex-col">
          <Link href="/" className="surface-card-dark rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-card)] text-sm font-[var(--font-syne)] font-[800] text-[var(--text-primary)]">
                  RP
                </div>
                <div>
                  <div className="text-heavy-primary font-[var(--font-syne)] text-lg font-[800] tracking-[-0.04em]">
                    RailFi
                  </div>
                  <div className="text-heavy-secondary text-[11px]">Settlement control rail</div>
                </div>
              </div>
              <Sparkles className="text-heavy-secondary h-4 w-4" />
            </div>
          </Link>

          <div className="mt-5 section-shell rounded-2xl p-3">
            <p className="px-2 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
              Navigation
            </p>
            <nav className="mt-3 space-y-2">
              {DASHBOARD_NAV.map(({ href, label, icon: Icon, description }) => {
                const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "nav-item flex items-center gap-3 rounded-lg px-4 py-3 transition-all active:scale-[0.99]",
                      active
                        ? "active bg-[var(--surface-heavy)] text-[var(--text-heavy-primary)] shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
                        : "text-[var(--text-2)] hover:bg-white/6 hover:text-[var(--text-1)]",
                    )}
                  >
                    <span
                      className={cn(
                        "nav-icon flex h-9 w-9 items-center justify-center rounded-full transition-transform duration-200",
                        active
                          ? "surface-heavy-soft text-heavy-primary"
                          : "bg-[var(--surface-muted)] text-[var(--text-2)]",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="font-[var(--font-syne)] text-[14px] font-[700] tracking-[-0.02em]">
                        {label}
                      </div>
                      <div className={cn("text-[11px]", active ? "text-heavy-secondary" : "text-[var(--text-3)]")}>
                        {description}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="mt-auto flex flex-col gap-6 pb-2">
            <div className="section-shell relative z-50 mb-1 overflow-visible rounded-2xl p-4">
              <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                Wallet access
              </p>
              <p className="mt-1 text-[13px] text-[var(--text-2)]">
                Connected rail for on-chain settlement actions
              </p>
              <div className="relative z-50 mt-3">
                <ClientWalletMultiButton />
              </div>
            </div>

            <a
              href={`https://explorer.solana.com/address/${PROGRAM_ID.toString()}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="surface-card relative z-0 flex items-center justify-between rounded-2xl px-4 py-3 text-[12px] text-[var(--text-2)] transition hover:-translate-y-0.5 hover:text-[var(--text-1)]"
            >
              <div>
                <div className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                  Program
                </div>
                <div className="mt-1 font-[var(--font-mono)]">{PROGRAM_ID.toString().slice(0, 8)}...</div>
              </div>
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <DashboardHeader />

          <main className="flex-1 px-2.5 py-3.5 sm:px-5 sm:py-6 lg:px-6 lg:py-6">
            <div className="mx-auto w-full max-w-7xl pb-28 lg:pb-0">
              <UnauthenticatedOverlay isAuthenticated={!!connected}>
                {children}
              </UnauthenticatedOverlay>
            </div>
          </main>

          <nav className="fixed bottom-3 left-1/2 z-40 flex w-[calc(100%-1rem)] max-w-md -translate-x-1/2 items-center justify-between rounded-full border border-black/25 bg-[var(--surface-heavy)]/96 p-2 shadow-[var(--shadow-panel)] backdrop-blur-2xl md:hidden">
            {DASHBOARD_NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "nav-item flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2.5 text-[11px] font-[var(--font-mono)] transition-all active:scale-[0.98]",
                    active
                      ? "bg-[var(--surface-card)] text-[var(--text-primary)] shadow-[0_10px_22px_rgba(255,255,255,0.18)]"
                      : "text-heavy-secondary",
                  )}
                >
                  <Icon className="nav-icon h-4 w-4 transition-transform duration-200" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}
