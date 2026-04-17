"use client";

import Link from "next/link";
import { ExternalLink, Shield, Sparkles, Waves, Zap } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { PROGRAM_ID } from "@/lib/solana";
import { ClientWalletMultiButton } from "@/components/ClientWalletMultiButton";
import { StatusPill } from "@/components/ui/StatusPill";

const PROOF_CARDS = [
  {
    icon: <Zap className="h-4 w-4" />,
    label: "Pyth locked",
    title: "Manipulation-resistant execution",
    body: "USDC/USD rate locked on-chain per request. Stale or manipulated prices auto-rejected.",
    tone: "var(--accent-mint)",
  },
  {
    icon: <Shield className="h-4 w-4" />,
    label: "Circuit breaker",
    title: "Autonomous volume guard",
    body: "Outflow spikes trigger a hard volume cap. Settlement halts before any exploit can drain.",
    tone: "var(--accent-peach)",
  },
  {
    icon: <Sparkles className="h-4 w-4" />,
    label: "ZK compressed",
    title: "Cheaper long-tail history",
    body: "Webhook records archived as compressed on-chain proofs. Cheaper history, same verifiability.",
    tone: "var(--accent-lavender)",
  },
];

const HIGHLIGHTS = [
  { value: "60s", label: "INR IN YOUR BANK" },
  { value: "Zero", label: "SWIFT OR CEX FEES" },
  { value: "1000x", label: "CHEAPER THAN WIRE" },
];

export default function LandingPage() {
  const programId = process.env.NEXT_PUBLIC_PROGRAM_ID ?? PROGRAM_ID.toString();

  return (
    <main className="mesh-bg min-h-screen px-3 py-4 sm:px-6 lg:px-8">
      <div className="app-shell mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl flex-col rounded-3xl p-4 sm:p-6">
        <nav className="surface-card relative flex items-center justify-between rounded-2xl px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-heavy)] text-sm font-[var(--font-syne)] font-[800] text-[var(--text-inverted)]">
              RF
            </div>
            <div>
              <div className="font-[var(--font-syne)] text-lg font-[800] tracking-[-0.04em]">RailFi</div>
              <div className="text-[11px] text-[var(--text-3)]">USDC to UPI settlement rail</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={`https://explorer.solana.com/address/${programId}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-card-soft)] px-4 py-2 text-[11px] font-[var(--font-syne)] font-[700] text-[var(--text-2)] transition hover:-translate-y-0.5 hover:text-[var(--text-1)] sm:inline-flex"
            >
              ◎ Live on Explorer
              <ExternalLink className="h-3 w-3" />
            </a>
            <ClientWalletMultiButton />
          </div>
        </nav>

        <section className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[1.15fr_0.85fr] lg:py-10">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/stats"
                className="cursor-pointer transition-opacity hover:opacity-80"
                title="View enterprise-grade settlement controls"
              >
                <span>
                  <StatusPill tone="dark">
                    <span className="pulse-dot h-2 w-2 rounded-full bg-[var(--green)]" />
                    Live on Devnet
                  </StatusPill>
                </span>
              </Link>
              <Link href="/stats" className="transition-opacity hover:opacity-80">
                <span>
                  <StatusPill tone="neutral">Enterprise-grade settlement controls</StatusPill>
                </span>
              </Link>
            </div>

            <div className="space-y-4">
              <h1 className="max-w-4xl text-5xl font-[var(--font-syne)] font-[800] leading-[0.92] tracking-[-0.07em] sm:text-6xl lg:text-7xl">
                Global USDC in.
                <br />
                <span className="gradient-text">UPI out in seconds.</span>
              </h1>
              <p className="max-w-2xl text-[15px] leading-7 text-[var(--text-2)] sm:text-[17px]">
                RailFi routes stablecoin balances through an on-chain guarded vault and executes a
                premium offramp flow to any UPI handle.
              </p>
            </div>

            <HeroCTASection />

            <div className="grid gap-3 sm:grid-cols-3">
              {HIGHLIGHTS.map((highlight) => (
                <article key={highlight.label} className="metric-panel rounded-2xl px-4 py-4">
                  <div className="text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
                    {highlight.value}
                  </div>
                  <p className="mt-1 text-[11px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--text-3)]">
                    {highlight.label}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="surface-hero relative overflow-hidden rounded-3xl p-5 sm:p-7">
            <div className="absolute -right-10 top-6 h-28 w-28 rounded-full bg-[var(--accent-lavender)] blur-3xl" />
            <div className="absolute bottom-10 left-4 h-20 w-20 rounded-full bg-[var(--accent-mint)] blur-3xl" />

            <div className="relative space-y-4">
              <div className="metric-panel-dark rounded-2xl p-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/50">
                    <span className="h-1 w-1 rounded-full bg-green-400" />
                    Demo Preview
                  </span>
                  <div className="surface-heavy-elevated text-heavy-secondary rounded-full p-3">
                    <Waves className="h-5 w-5" />
                  </div>
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-heavy-muted text-[11px] font-[var(--font-mono)] uppercase tracking-[0.18em]">
                      Wallet value
                    </p>
                    <h2 className="text-heavy-primary mt-3 text-4xl font-[var(--font-syne)] font-[800] tracking-[-0.06em] sm:text-5xl">
                      $12,788.56
                    </h2>
                    <p className="text-heavy-secondary mt-2 text-sm">Built for consumers. Guarded like infra.</p>
                  </div>
                </div>

                <div className="mt-5 flex gap-2">
                  <div className="action-pill-contrast">Transfer</div>
                  <div className="action-pill-dark">Protect</div>
                  <div className="action-pill-dark">Audit</div>
                </div>

                <p className="mt-4 text-center text-[11px] tracking-wide text-white/30">
                  Connect wallet to see your live balance
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {PROOF_CARDS.map((card) => (
                  <article
                    key={card.title}
                    className="rounded-2xl border border-[var(--border)] p-4 shadow-[0_16px_28px_rgba(10,10,10,0.06)]"
                    style={{ backgroundColor: card.tone }}
                  >
                    <div className="mb-4 inline-flex rounded-full border border-[var(--border)] bg-[var(--surface-card)] p-2 text-[var(--text-1)]">
                      {card.icon}
                    </div>
                    <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--text-3)]">
                      {card.label}
                    </p>
                    <h3 className="mt-2 text-lg font-[var(--font-syne)] font-[700] tracking-[-0.04em]">
                      {card.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-[color:var(--text-2)]/70">{card.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <footer className="flex flex-col gap-3 border-t border-[var(--border)] px-2 pt-5 text-[11px] font-[var(--font-mono)] text-[var(--text-3)] sm:flex-row sm:items-center sm:justify-between">
          <span>RailFi protocol on Devnet. High-contrast UX for consumer-grade settlement rails.</span>
          <a
            href={`https://explorer.solana.com/address/${PROGRAM_ID.toString()}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[var(--text-2)] transition hover:text-[var(--text-1)]"
          >
            Program on Explorer
            <ExternalLink className="h-3 w-3" />
          </a>
        </footer>
      </div>
    </main>
  );
}

function HeroCTASection() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        <Link
          href="/dashboard"
          className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-white px-7 py-3.5 text-sm font-semibold text-black shadow-[0_0_0_1px_rgba(255,255,255,0.15)] transition-all duration-200 hover:bg-white/90 hover:shadow-[0_8px_32px_rgba(255,255,255,0.15)] active:scale-[0.98]"
        >
          <span
            className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full"
            aria-hidden
          />
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
            className="flex-shrink-0"
          >
            <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9" />
            <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.5" />
            <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.5" />
            <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9" />
          </svg>
          Open Dashboard
        </Link>

        <Link
          href="/demo"
          className="group inline-flex items-center justify-center gap-2 rounded-xl border border-black/10 bg-black/[0.02] px-7 py-3.5 text-sm font-medium text-black/70 backdrop-blur-sm transition-all duration-200 hover:border-black/15 hover:bg-black/5 hover:text-black active:scale-[0.98]"
        >
          <span className="relative flex h-2 w-2 flex-shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
          </span>
          Explore Transfer Flow
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          >
            <path
              d="M2.5 7H11.5M11.5 7L8 3.5M11.5 7L8 10.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
      </div>

      <GoogleSignInButton
        callbackUrl="/dashboard"
        className="inline-flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-5 py-3 text-sm font-[var(--font-syne)] font-[700] text-[var(--text-1)] shadow-[0_12px_24px_rgba(10,10,10,0.06)] transition hover:-translate-y-0.5"
      >
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-card-soft)] text-[11px] font-[var(--font-mono)]">
          G
        </span>
        Sign in with Google
      </GoogleSignInButton>
    </div>
  );
}
