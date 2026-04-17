import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";

function SkeletonBlock({
  className,
  dark = false,
}: {
  className?: string;
  dark?: boolean;
}) {
  return dark ? (
    <div className={cn("shimmer-dark rounded-[18px]", className)} />
  ) : (
    <Skeleton className={cn("rounded-[18px]", className)} />
  );
}

export function PageHeaderSkeleton() {
  return (
    <section className="surface-hero rounded-3xl p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <SkeletonBlock className="h-4 w-20 rounded-full" />
          <SkeletonBlock className="h-10 w-80 max-w-full" />
          <SkeletonBlock className="h-4 w-[32rem] max-w-full" />
          <SkeletonBlock className="h-4 w-56 max-w-[75%]" />
          <div className="flex flex-wrap gap-2 pt-2">
            <SkeletonBlock className="h-10 w-36 rounded-full" />
            <SkeletonBlock className="h-10 w-52 rounded-full" />
          </div>
        </div>
        <SkeletonBlock className="h-11 w-28 rounded-lg" />
      </div>
    </section>
  );
}

export function CircuitBreakerSkeleton() {
  return (
    <section className="metric-panel-dark rounded-2xl p-5">
      <div className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <div className="flex gap-2">
              <SkeletonBlock dark className="h-8 w-28 rounded-full" />
              <SkeletonBlock dark className="h-8 w-20 rounded-full" />
            </div>
            <SkeletonBlock dark className="h-9 w-80 max-w-full" />
            <SkeletonBlock dark className="h-4 w-[30rem] max-w-full" />
            <SkeletonBlock dark className="h-4 w-72 max-w-[85%]" />
          </div>
          <div className="surface-heavy-elevated rounded-[24px] p-4">
            <SkeletonBlock dark className="h-3 w-24 rounded-full" />
            <SkeletonBlock dark className="mt-3 h-8 w-28 rounded-full" />
          </div>
        </div>
        <div className="surface-heavy-soft rounded-[24px] p-4">
          <div className="flex items-center justify-between gap-3">
            <SkeletonBlock dark className="h-3 w-24 rounded-full" />
            <SkeletonBlock dark className="h-3 w-36 rounded-full" />
          </div>
          <SkeletonBlock dark className="mt-3 h-3 w-full rounded-full" />
        </div>
      </div>
    </section>
  );
}

export function WalletDashboardSkeleton() {
  return (
    <section className="section-shell overflow-hidden rounded-2xl p-5 sm:p-6">
      <div className="border-b border-black/8 pb-5">
        <div className="flex items-center justify-between gap-4">
          <SkeletonBlock className="h-3 w-20 rounded-full" />
          <SkeletonBlock className="h-4 w-20 rounded-full" />
        </div>
        <SkeletonBlock className="mt-4 h-16 w-52 rounded-[22px]" />
        <div className="mt-3 flex items-center gap-2">
          <SkeletonBlock className="h-3 w-24 rounded-full" />
          <SkeletonBlock className="h-3 w-10 rounded-full" />
          <SkeletonBlock className="h-3 w-12 rounded-full" />
        </div>
      </div>

      <div className="mt-4 border-b border-black/8 pb-2">
        <div className="flex gap-5">
          <SkeletonBlock className="h-4 w-16 rounded-full" />
          <SkeletonBlock className="h-4 w-20 rounded-full" />
        </div>
      </div>

      <div className="divide-y divide-black/8">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <SkeletonBlock className="h-4 w-36 rounded-full" />
                <SkeletonBlock className="h-4 w-20 rounded-full" />
              </div>
              <div className="flex flex-wrap gap-2">
                <SkeletonBlock className="h-3 w-24 rounded-full" />
                <SkeletonBlock className="h-3 w-28 rounded-full" />
              </div>
            </div>
            <div className="space-y-2">
              <SkeletonBlock className="h-4 w-24 rounded-full" />
              <SkeletonBlock className="h-3 w-28 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DashboardPageSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />

      <section className="surface-hero overflow-hidden rounded-3xl p-5 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <SkeletonBlock className="h-8 w-40 rounded-full" />
            <div className="space-y-3">
              <SkeletonBlock className="h-4 w-24 rounded-full" />
              <SkeletonBlock className="h-16 w-56 rounded-[22px]" />
              <SkeletonBlock className="h-4 w-[34rem] max-w-full" />
              <SkeletonBlock className="h-4 w-80 max-w-[85%]" />
            </div>
          </div>
          <div className="metric-panel-dark rounded-2xl p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <SkeletonBlock dark className="h-3 w-28 rounded-full" />
                <SkeletonBlock dark className="h-9 w-9 rounded-full" />
              </div>
              <SkeletonBlock dark className="h-8 w-64 rounded-[18px]" />
              <div className="grid gap-3 sm:grid-cols-2">
                <SkeletonBlock className="h-12 w-full rounded-full" />
                <SkeletonBlock dark className="h-12 w-full rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <article
            key={index}
            className={cn(
              "rounded-2xl p-5",
              index === 1 ? "metric-panel-dark" : "metric-panel",
            )}
          >
            <SkeletonBlock dark={index === 1} className="h-3 w-24 rounded-full" />
            <SkeletonBlock dark={index === 1} className="mt-4 h-9 w-36 rounded-[18px]" />
            <SkeletonBlock dark={index === 1} className="mt-3 h-3 w-28 rounded-full" />
          </article>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <CircuitBreakerSkeleton />
        <WalletDashboardSkeleton />
      </div>
    </div>
  );
}

export function TransferComposerSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className={cn("rounded-2xl p-4 sm:p-5", index === 1 ? "metric-panel-dark" : "metric-panel")}>
            <SkeletonBlock dark={index === 1} className="h-3 w-24 rounded-full" />
            <SkeletonBlock dark={index === 1} className="mt-4 h-9 w-32 rounded-[18px]" />
            <SkeletonBlock dark={index === 1} className="mt-3 h-3 w-28 rounded-full" />
          </div>
        ))}
      </div>

      <div className="grid items-start gap-5 sm:gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="section-shell rounded-2xl p-5 sm:p-6">
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <SkeletonBlock className="h-3 w-12 rounded-full" />
                <SkeletonBlock className="h-8 w-52 rounded-[18px]" />
                <SkeletonBlock className="h-4 w-64 rounded-full" />
              </div>
              <SkeletonBlock className="h-9 w-28 rounded-full" />
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <SkeletonBlock className="h-3 w-24 rounded-full" />
                <SkeletonBlock className="h-3 w-16 rounded-full" />
              </div>
              <SkeletonBlock className="h-14 w-full rounded-lg" />
              <SkeletonBlock className="mx-auto h-12 w-full max-w-sm rounded-lg" />
            </div>
          </div>
        </div>

        <div className="metric-panel-dark rounded-2xl p-5 sm:p-6">
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <SkeletonBlock dark className="h-3 w-12 rounded-full" />
                <SkeletonBlock dark className="h-8 w-60 rounded-[18px]" />
                <SkeletonBlock dark className="h-4 w-72 rounded-full" />
              </div>
              <SkeletonBlock dark className="h-9 w-20 rounded-full" />
            </div>
            <div className="space-y-4">
              <SkeletonBlock dark className="h-3 w-28 rounded-full" />
              <SkeletonBlock dark className="h-14 w-full rounded-lg" />
              <SkeletonBlock dark className="h-3 w-32 rounded-full" />
              <SkeletonBlock dark className="h-14 w-full rounded-lg" />
            </div>
            <div className="surface-reset-light rounded-2xl p-5">
              <SkeletonBlock className="h-3 w-28 rounded-full" />
              <SkeletonBlock className="mt-4 h-11 w-44 rounded-[18px]" />
              <SkeletonBlock className="mt-3 h-4 w-64 rounded-full" />
              <SkeletonBlock className="mt-2 h-4 w-52 rounded-full" />
            </div>
            <SkeletonBlock className="h-12 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function TransferPageSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <TransferComposerSkeleton />
        <section className="section-shell rounded-2xl p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-3">
              <SkeletonBlock className="h-3 w-24 rounded-full" />
              <SkeletonBlock className="h-8 w-60 rounded-[18px]" />
            </div>
            <div className="flex flex-wrap gap-2">
              <SkeletonBlock className="h-8 w-40 rounded-full" />
              <SkeletonBlock className="h-8 w-56 rounded-full" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function HistoryLedgerSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="data-row p-5">
          <div className="flex items-start gap-4">
            <SkeletonBlock className="h-12 w-12 rounded-[18px]" />
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap gap-2">
                <SkeletonBlock className="h-4 w-40 rounded-full" />
                <SkeletonBlock className="h-4 w-24 rounded-full" />
                <SkeletonBlock className="h-4 w-20 rounded-full" />
              </div>
              <SkeletonBlock className="h-3 w-64 rounded-full" />
            </div>
            <div className="space-y-2 text-right">
              <SkeletonBlock className="h-4 w-24 rounded-full" />
              <SkeletonBlock className="h-3 w-16 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function HistoryPageSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <HistoryLedgerSkeleton />
    </div>
  );
}
