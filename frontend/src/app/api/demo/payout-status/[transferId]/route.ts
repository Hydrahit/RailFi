import { NextRequest, NextResponse } from "next/server";
import { getDemoOfframpRecord } from "@/lib/demo-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ transferId: string }> },
): Promise<NextResponse> {
  const { transferId } = await context.params;
  const record = await getDemoOfframpRecord(transferId);
  if (!record) {
    return NextResponse.json({ error: "Demo transfer not found." }, { status: 404 });
  }

  return NextResponse.json(
    {
      transferId: record.transferId,
      state: record.state,
      utr: record.utr,
      amountInr: record.amountInr,
      explorerUrl: record.explorerUrl,
    },
    { status: 200 },
  );
}
