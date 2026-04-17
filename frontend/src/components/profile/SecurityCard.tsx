import type { ProfileSummary } from "@/types/offramp";

export function SecurityCard({ profile }: { profile: ProfileSummary }) {
  return (
    <section className="section-shell rounded-3xl p-6">
      <p className="text-[11px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
        Security
      </p>
      <h2 className="mt-2 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
        Identity and wallet trust
      </h2>

      <div className="mt-5 grid gap-3">
        <div className="data-row rounded-2xl px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-[var(--font-syne)] text-[15px] font-[700]">Google account</div>
              <p className="mt-1 text-[12px] text-[var(--text-2)]">
                {profile.googleLinked ? "Linked and available for hybrid sign-in." : "Not linked yet."}
              </p>
            </div>
            {profile.googleLinked ? (
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-card-soft)] px-3 py-1 text-[11px] font-[var(--font-mono)] text-[var(--text-2)]">
                Linked
              </span>
            ) : (
              <a
                href="/api/auth/signin/google?callbackUrl=/profile"
                className="btn-ghost w-auto"
              >
                Link Google
              </a>
            )}
          </div>
        </div>

        <div className="data-row rounded-2xl px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-[var(--font-syne)] text-[15px] font-[700]">Phantom wallet</div>
              <p className="mt-1 text-[12px] text-[var(--text-2)]">
                Active wallet session is the current source of truth for settlement actions.
              </p>
            </div>
            <span className="rounded-full bg-[var(--accent-green-bg)] px-3 py-1 text-[11px] font-[var(--font-mono)] text-[var(--success-fg)]">
              Linked
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
