"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  History,
  LayoutDashboard,
  Menu,
  Sparkles,
  TrendingUp,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ClientWalletMultiButton } from "@/components/ClientWalletMultiButton";
import { ProgramIdBadge } from "@/components/ProgramIdBadge";
import { StatusPill } from "@/components/ui/StatusPill";

export interface DashboardNavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

export const DASHBOARD_NAV: DashboardNavItem[] = [
  {
    href: "/dashboard",
    label: "Overview",
    icon: LayoutDashboard,
    description: "Balances and safety",
  },
  {
    href: "/transfer",
    label: "Transfer",
    icon: ArrowUpRight,
    description: "USDC to UPI flow",
  },
  {
    href: "/history",
    label: "History",
    icon: History,
    description: "Ledger and proofs",
  },
  {
    href: "/yield",
    label: "Yield",
    icon: TrendingUp,
    description: "Kamino benchmark",
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: BarChart3,
    description: "Public chain metrics",
  },
  {
    href: "/profile",
    label: "Profile",
    icon: UserRound,
    description: "Identity and limits",
  },
];

function isActiveRoute(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
}

function shouldShowBackButton(pathname: string): boolean {
  return pathname !== "/dashboard";
}

function getModeLabel(pathname: string): "demo" | "live" {
  return pathname === "/demo" ? "demo" : "live";
}

function MobileNavDrawer({
  pathname,
  open,
  onClose,
}: {
  pathname: string;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="Close navigation"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="absolute right-3 top-3 w-[min(88vw,22rem)] rounded-3xl border border-[var(--border)] bg-[var(--surface-muted)]/96 p-4 shadow-[var(--shadow-panel)] backdrop-blur-2xl">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="flex items-center gap-3"
            onClick={onClose}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-heavy)] text-sm font-[var(--font-syne)] font-[800] text-[var(--text-heavy-primary)]">
              RF
            </div>
            <div>
              <div className="font-[var(--font-syne)] text-lg font-[800] tracking-[-0.04em]">
                RailFi
              </div>
              <div className="text-[11px] text-[var(--text-3)]">Settlement rail</div>
            </div>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-card-soft)] text-[var(--text-2)] transition hover:text-[var(--text-1)]"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <ModeBadge mode={getModeLabel(pathname)} />
          <StatusPill tone="neutral">
            <Sparkles className="h-3.5 w-3.5" />
            Window shopping enabled
          </StatusPill>
        </div>

        <nav className="mt-5 space-y-2">
          {DASHBOARD_NAV.map(({ href, label, icon: Icon, description }) => {
            const active = isActiveRoute(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={cn(
                  "nav-item flex items-center gap-3 rounded-2xl px-4 py-3 transition-all active:scale-[0.99]",
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

        <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-card-soft)] p-4">
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Wallet access
          </p>
          <p className="mt-1 text-[13px] text-[var(--text-2)]">
            Connected rail for on-chain settlement actions
          </p>
          <div className="mt-3">
            <ClientWalletMultiButton />
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeBadge({ mode }: { mode: "demo" | "live" }) {
  if (mode === "demo") {
    return <StatusPill tone="neutral">Demo Mode</StatusPill>;
  }

  return (
    <StatusPill tone="success">
      <span className="status-dot" />
      Live on Devnet
    </StatusPill>
  );
}

export function DashboardHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const showBackButton = useMemo(() => shouldShowBackButton(pathname), [pathname]);
  const mode = getModeLabel(pathname);

  return (
    <>
      <header className="topbar-shell relative z-[100] px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-heavy)] text-sm font-[var(--font-syne)] font-[800] text-[var(--text-heavy-primary)]">
                RP
              </div>
              <div className="min-w-0">
                <div className="truncate font-[var(--font-syne)] text-lg font-[800] tracking-[-0.04em]">
                  RailFi
                </div>
                <div className="text-[11px] text-[var(--text-3)]">Settlement rail</div>
              </div>
            </Link>

            {showBackButton ? (
              <button
                type="button"
                onClick={() => router.back()}
                className="hidden items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-card-soft)] px-3 py-2 text-[11px] font-[var(--font-mono)] text-[var(--text-2)] transition hover:text-[var(--text-1)] md:inline-flex"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 md:flex">
              <ModeBadge mode={mode} />
              <ProgramIdBadge showFull={false} />
              <Link
                href={mode === "demo" ? "/stats" : "/demo"}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-card-soft)] px-4 py-2 text-[11px] font-[var(--font-mono)] text-[var(--text-2)] transition hover:text-[var(--text-1)]"
              >
                {mode === "demo" ? "View live stats" : "Try demo mode"}
              </Link>
            </div>

            <div className="hidden sm:block">
              <ClientWalletMultiButton />
            </div>

            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-card-soft)] text-[var(--text-2)] transition hover:text-[var(--text-1)] lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 md:hidden">
          {showBackButton ? (
            <button
              type="button"
              onClick={() => router.back()}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-card-soft)] px-3 py-2 text-[11px] font-[var(--font-mono)] text-[var(--text-2)] transition hover:text-[var(--text-1)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
          ) : null}
          <ModeBadge mode={mode} />
          <ProgramIdBadge showFull={false} />
        </div>
      </header>

      <MobileNavDrawer
        pathname={pathname}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
    </>
  );
}
