import { NextRequest, NextResponse } from "next/server";
import { markDemoCsvReady } from "@/lib/demo-store";
import { PROGRAM_ID } from "@/lib/solana";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeCsv(value: string | number): string {
  const stringValue = String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const transferId = request.nextUrl.searchParams.get("transferId")?.trim();
  if (!transferId) {
    return NextResponse.json({ error: "Missing transferId." }, { status: 400 });
  }

  const record = await markDemoCsvReady(transferId);
  if (!record) {
    return NextResponse.json({ error: "Demo transfer not found." }, { status: 404 });
  }

  const csv = [
    ["transferId", record.transferId],
    ["walletAddress", record.walletAddress],
    ["upiId", record.upiId],
    ["amountInr", record.amountInr],
    ["utr", record.utr ?? ""],
    ["programId", PROGRAM_ID.toBase58()],
    ["generatedAt", new Date().toISOString()],
  ]
    .map(([key, value]) => `${escapeCsv(key)},${escapeCsv(value)}`)
    .join("\r\n");

  return new NextResponse(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="railfi-demo-tax-${record.transferId}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
