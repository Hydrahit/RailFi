import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { KycStatusCard } from "@/components/profile/KycStatusCard";
import { UpiHandlesCard } from "@/components/profile/UpiHandlesCard";
import { SecurityCard } from "@/components/profile/SecurityCard";
import { DangerZoneCard } from "@/components/profile/DangerZoneCard";
import { getProfileSummary, listWalletOfframpRecords } from "@/lib/offramp-store";
import { getWalletSessionFromCookies } from "@/lib/wallet-session-server";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getWalletSessionFromCookies(cookies());
  if (!session) {
    redirect("/");
  }

  const [profile, recentRecords] = await Promise.all([
    getProfileSummary(session.walletAddress),
    listWalletOfframpRecords(session.walletAddress, 5),
  ]);

  return (
    <main className="mesh-bg dark min-h-screen px-3 py-4 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <ProfileHeader profile={profile} />
        <KycStatusCard profile={profile} />
        <UpiHandlesCard initialHandles={profile.handles} />
        <SecurityCard profile={profile} />

        <section className="section-shell rounded-3xl p-6">
          <p className="text-[11px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
            Recent settlements
          </p>
          <h2 className="mt-2 text-2xl font-[var(--font-syne)] font-[800] tracking-[-0.05em]">
            Latest payout trail
          </h2>
          <div className="mt-5 space-y-3">
            {recentRecords.length === 0 ? (
              <p className="text-[13px] text-[var(--text-2)]">No offramp records yet.</p>
            ) : (
              recentRecords.map((record) => (
                <a
                  key={record.transferId}
                  href={`https://explorer.solana.com/tx/${record.solanaTx}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="data-row flex items-center justify-between rounded-2xl px-4 py-4"
                >
                  <div>
                    <div className="font-[var(--font-syne)] text-[15px] font-[700]">
                      Rs {record.amountInr.toLocaleString("en-IN")}
                    </div>
                    <p className="mt-1 text-[12px] text-[var(--text-2)]">
                      {record.upiMasked} · {record.status}
                    </p>
                  </div>
                  <span className="text-[12px] font-[var(--font-mono)] text-[var(--text-3)]">◎ Explorer</span>
                </a>
              ))
            )}
          </div>
        </section>

        <DangerZoneCard />
      </div>
    </main>
  );
}
