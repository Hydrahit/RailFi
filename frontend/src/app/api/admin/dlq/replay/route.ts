import { NextRequest, NextResponse } from "next/server";
import { processCashfreeWebhookPayload } from "@/lib/cashfree-webhook-processor";
import { getServerRedis } from "@/lib/upstash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN;

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  return !!INTERNAL_TOKEN && authHeader === `Bearer ${INTERNAL_TOKEN}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // SECURITY: DLQ replay mutates payout state and must only be available to internal operators.
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { transferId?: unknown } | null;
  const transferId = typeof body?.transferId === "string" ? body.transferId.trim() : "";
  if (!transferId) {
    return NextResponse.json({ error: "transferId is required" }, { status: 400 });
  }

  const redis = getServerRedis("dlq replay");
  const dlqKey = `offramp:dlq:${transferId}`;
  const raw = await redis.get<unknown>(dlqKey);
  if (!raw) {
    return NextResponse.json({ error: "No DLQ entry found for this transferId" }, { status: 404 });
  }

  let payload: unknown = raw;
  try {
    if (typeof raw === "string") {
      payload = JSON.parse(raw);
    }
    if (payload && typeof payload === "object" && typeof (payload as { payload?: unknown }).payload === "string") {
      payload = JSON.parse((payload as { payload: string }).payload);
    }
    if (payload && typeof payload === "object" && typeof (payload as { raw?: unknown }).raw === "string") {
      payload = JSON.parse((payload as { raw: string }).raw);
    }
  } catch {
    return NextResponse.json(
      { error: "DLQ payload is malformed JSON - manual intervention required" },
      { status: 422 },
    );
  }

  try {
    await processCashfreeWebhookPayload(payload);
    // SECURITY: Keep a replay audit marker so operators can prove when a dead-lettered payout was recovered.
    await redis.set(`${dlqKey}:replayed`, JSON.stringify({ replayedAt: Date.now(), success: true }), {
      ex: 60 * 60 * 24 * 90,
    });
    await redis.del(dlqKey);

    return NextResponse.json({ ok: true, transferId, replayed: true });
  } catch (error) {
    console.error("[dlq-replay] Replay failed", transferId, error);
    return NextResponse.json({ error: "Replay failed", detail: String(error) }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // SECURITY: Listing DLQ keys exposes payout identifiers and is restricted to internal operators.
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redis = getServerRedis("dlq replay");
  const liveKeys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, {
      match: "offramp:dlq:*",
      count: 100,
    });
    liveKeys.push(...keys.filter((key) => !key.endsWith(":replayed")));
    cursor = nextCursor;
  } while (cursor !== "0");

  return NextResponse.json({ count: liveKeys.length, keys: liveKeys });
}
