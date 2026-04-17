import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { TransferScreen } from "@/features/offramp/components/TransferScreen";

export default function DemoPage() {
  return (
    <div className="mesh-bg dark min-h-screen px-2.5 py-3 sm:px-4 sm:py-5">
      <div className="app-shell mx-auto min-h-[calc(100vh-2rem)] max-w-7xl overflow-hidden rounded-3xl">
        <DashboardHeader />
        <div className="px-4 pt-4 sm:px-6">
          <DemoBanner />
        </div>
        <div className="p-4 sm:p-6">
          <TransferScreen demoMode />
        </div>
      </div>
    </div>
  );
}
