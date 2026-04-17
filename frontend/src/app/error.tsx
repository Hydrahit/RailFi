"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mesh-bg flex min-h-screen items-center justify-center px-4 py-8">
      <div className="section-shell w-full max-w-xl rounded-3xl p-8 text-center">
        <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
          Load error
        </p>
        <h1 className="mt-3 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
          Something went wrong while loading RailFi.
        </h1>
        <p className="mt-3 text-[14px] leading-7 text-[var(--text-2)]">
          The page failed to render, but your wallet and funds are unaffected.
        </p>
        {error.digest ? (
          <p className="mt-4 text-[11px] font-[var(--font-mono)] text-[var(--text-3)]">
            Error ID: {error.digest}
          </p>
        ) : null}
        <div className="mt-6 flex justify-center">
          <button type="button" onClick={reset} className="btn-primary btn-accent max-w-[220px] rounded-lg">
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
