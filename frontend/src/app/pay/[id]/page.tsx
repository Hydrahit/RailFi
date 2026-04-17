import nextDynamic from "next/dynamic";
import { getInvoice } from "@/lib/invoice-store";
import { toPublicInvoiceRecord } from "@/types/invoice";

export const dynamic = "force-dynamic";

const PayInvoiceClient = nextDynamic(
  () => import("@/components/PayInvoiceClient").then((mod) => mod.PayInvoiceClient),
  {
    ssr: false,
    loading: () => (
      <section className="mesh-bg min-h-screen px-4 py-6 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="section-shell rounded-3xl p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-4 w-28 rounded bg-[var(--surface-muted)]" />
              <div className="h-12 w-3/4 rounded bg-[var(--surface-muted)]" />
              <div className="h-24 w-full rounded bg-[var(--surface-muted)]" />
            </div>
          </div>
        </div>
      </section>
    ),
  },
);

export default async function PayInvoicePage({
  params,
}: {
  params: { id: string };
}) {
  const invoice = await getInvoice(params.id);
  return <PayInvoiceClient invoice={invoice ? toPublicInvoiceRecord(invoice) : null} />;
}
