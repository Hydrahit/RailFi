import type { ProfileSummary } from "@/types/offramp";

function progressWidth(used: number, limit: number): string {
  if (!limit || limit <= 0) {
    return "0%";
  }
  return `${Math.min(100, (used / limit) * 100)}%`;
}

function progressTone(used: number, limit: number): string {
  if (!limit || limit <= 0) {
    return "var(--border)";
  }
  const ratio = used / limit;
  if (ratio > 0.9) {
    return "var(--danger-fg)";
  }
  if (ratio > 0.7) {
    return "var(--warning-fg)";
  }
  return "var(--green)";
}

export function KycStatusCard({ profile }: { profile: ProfileSummary }) {
  return (
    <section className="section-shell rounded-3xl p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            KYC tier
          </p>
          <h2 className="mt-2 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
            {profile.kycTierLabel}
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-[var(--text-2)]">
            Daily limit Rs {profile.dailyLimitInr.toLocaleString("en-IN")} · Monthly limit Rs{" "}
            {profile.monthlyLimitInr.toLocaleString("en-IN")}
          </p>
        </div>

        <div className="rounded-full border border-[var(--border)] bg-[var(--surface-card-soft)] px-4 py-2 text-[11px] font-[var(--font-mono)] text-[var(--text-2)]">
          Verified by Sumsub
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between text-[12px] text-[var(--text-2)]">
            <span>Daily usage</span>
            <span>
              Rs {profile.usedTodayInr.toLocaleString("en-IN")} / Rs {profile.dailyLimitInr.toLocaleString("en-IN")}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--bg-input)]">
            <div
              className="h-2 rounded-full transition-all duration-500"
              style={{
                width: progressWidth(profile.usedTodayInr, profile.dailyLimitInr),
                background: progressTone(profile.usedTodayInr, profile.dailyLimitInr),
              }}
            />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-[12px] text-[var(--text-2)]">
            <span>Monthly usage</span>
            <span>
              Rs {profile.usedMonthInr.toLocaleString("en-IN")} / Rs {profile.monthlyLimitInr.toLocaleString("en-IN")}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--bg-input)]">
            <div
              className="h-2 rounded-full transition-all duration-500"
              style={{
                width: progressWidth(profile.usedMonthInr, profile.monthlyLimitInr),
                background: progressTone(profile.usedMonthInr, profile.monthlyLimitInr),
              }}
            />
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4 text-[12px]">
        <span className="text-[var(--text-2)]">
          {profile.kycVerifiedAt
            ? `Verified ${new Date(profile.kycVerifiedAt).toLocaleDateString("en-IN")}`
            : "Verification not completed yet"}
        </span>
        {profile.kycTier < 3 ? (
          <a href="/demo" className="btn-ghost w-auto">
            Upgrade KYC
          </a>
        ) : null}
      </div>
      <div className="mt-3 text-[11px] text-[var(--text-3)]">
        KYC powered by <a href="https://sumsub.com" target="_blank" rel="noreferrer" className="underline">Sumsub</a>
      </div>
    </section>
  );
}
