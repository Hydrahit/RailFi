"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body className="mesh-bg flex min-h-screen items-center justify-center px-4 py-8">
        <div className="section-shell w-full max-w-lg rounded-3xl p-8 text-center">
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Global error
          </p>
          <h1 className="mt-3 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
            RailFi encountered an unrecoverable error.
          </h1>
          <p className="mt-3 text-[14px] leading-7 text-[var(--text-2)]">
            Refresh the page to try again. Your wallet and funds are unaffected.
          </p>
          {error.digest ? (
            <p className="mt-4 text-[11px] font-[var(--font-mono)] text-[var(--text-3)]">
              Error ID: {error.digest}
            </p>
          ) : null}
          <div className="mt-6 flex justify-center">
            <button type="button" onClick={reset} className="btn-primary btn-accent max-w-[220px] rounded-lg">
              Refresh
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
