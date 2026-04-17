import { NextRequest, NextResponse } from "next/server";
import { runReconciliation } from "@/lib/reconciliation";
import { verifyQstashRequest } from "@/lib/qstash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorizedCronRequest(request: NextRequest): boolean {
  const bearer = request.headers.get("authorization")?.trim();
  const configuredToken = process.env.INTERNAL_API_TOKEN?.trim();

  if (configuredToken && bearer === `Bearer ${configuredToken}`) {
    return true;
  }

  return request.headers.get("x-vercel-cron") === "1";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runReconciliation();
  return NextResponse.json({ ok: true, summary }, { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();

  if (process.env.QSTASH_TOKEN?.trim()) {
    const isValid = await verifyQstashRequest(request, rawBody).catch(() => false);
    if (!isValid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runReconciliation();
  return NextResponse.json({ ok: true, summary }, { status: 200 });
}
