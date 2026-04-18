import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireInternalAuth } from "@/lib/internal-auth";
import { acquireLock, releaseLock } from "@/lib/redis-lock";
import { runReconciliation } from "@/lib/reconciliation";

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

  const reconcileLockToken = randomUUID();
  const lockAcquired = await acquireLock("reconciliation:global", reconcileLockToken, 300);

  if (!lockAcquired) {
    console.log("[reconcile] Lock not acquired - another worker is running, skipping");
    return NextResponse.json({ skipped: true, reason: "lock_held" });
  }

  try {
    const summary = await runReconciliation();
    return NextResponse.json({ ok: true, summary }, { status: 200 });
  } finally {
    await releaseLock("reconciliation:global", reconcileLockToken);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  const auth = await requireInternalAuth(request, rawBody);
  if (!auth.ok) {
    return auth.response;
  }

  const reconcileLockToken = randomUUID();
  const lockAcquired = await acquireLock("reconciliation:global", reconcileLockToken, 300);

  if (!lockAcquired) {
    console.log("[reconcile] Lock not acquired - another worker is running, skipping");
    return NextResponse.json({ skipped: true, reason: "lock_held" });
  }

  try {
    JSON.parse(rawBody || "{}");
    const summary = await runReconciliation();
    return NextResponse.json({ ok: true, summary }, { status: 200 });
  } finally {
    await releaseLock("reconciliation:global", reconcileLockToken);
  }
}
