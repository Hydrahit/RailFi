import { NextRequest, NextResponse } from "next/server";
import {
  createDemoOfframpRecord,
  createDemoTransferId,
} from "@/lib/demo-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DemoExecuteBody {
  amountMicroUsdc?: unknown;
  upiId?: unknown;
  inrPaise?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: DemoExecuteBody = {};
  try {
    body = (await request.json()) as DemoExecuteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const amountMicroUsdc =
    typeof body.amountMicroUsdc === "string" ? body.amountMicroUsdc.trim() : "";
  const upiId = typeof body.upiId === "string" ? body.upiId.trim().toLowerCase() : "";
  const inrPaise = typeof body.inrPaise === "string" ? body.inrPaise.trim() : "";

  if (!amountMicroUsdc || !upiId || !inrPaise) {
    return NextResponse.json({ error: "Missing demo offramp parameters." }, { status: 400 });
  }

  const transferId = createDemoTransferId();
  const amountInr = (Number(inrPaise) / 100).toFixed(2);
  const record = await createDemoOfframpRecord({
    transferId,
    upiId,
    amountMicroUsdc,
    amountInr,
  });

  const demoHeader = process.env.DEMO_API_SECRET?.trim() ?? "demo-mode";
  void fetch(new URL(`/api/demo/payout-status/${transferId}`, request.url), {
    method: "GET",
    headers: {
      "x-railfi-demo": demoHeader,
    },
    cache: "no-store",
  }).catch(() => undefined);

  return NextResponse.json(
    {
      transferId,
      state: record.state,
      amountInr: record.amountInr,
      explorerUrl: record.explorerUrl,
    },
    { status: 200 },
  );
}
