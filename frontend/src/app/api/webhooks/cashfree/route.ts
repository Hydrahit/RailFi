import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  getOfframpRecord,
  mapCashfreeStatusToOfframpStatus,
  updateOfframpRecord,
  writeOfframpDeadLetter,
} from "@/lib/offramp-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timingSafeMatches(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.CASHFREE_CLIENT_SECRET?.trim();
  if (!secret || !signature) {
    return false;
  }

  const digestHex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const digestBase64 = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");

  return timingSafeMatches(digestHex, signature) || timingSafeMatches(digestBase64, signature);
}

function readNestedString(value: unknown, path: string[]): string | null {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function extractTransferId(payload: Record<string, unknown>): string | null {
  return (
    readNestedString(payload, ["data", "transferId"]) ??
    readNestedString(payload, ["data", "referenceId"]) ??
    readNestedString(payload, ["transferId"]) ??
    readNestedString(payload, ["referenceId"])
  );
}

function extractStatus(payload: Record<string, unknown>): string | null {
  return (
    readNestedString(payload, ["data", "status"]) ??
    readNestedString(payload, ["data", "transferStatus"]) ??
    readNestedString(payload, ["status"]) ??
    readNestedString(payload, ["transferStatus"])
  );
}

function extractEventType(payload: Record<string, unknown>): string | null {
  return (
    readNestedString(payload, ["event"]) ??
    readNestedString(payload, ["type"]) ??
    readNestedString(payload, ["data", "event"])
  );
}

function extractUtr(payload: Record<string, unknown>): string | null {
  return readNestedString(payload, ["data", "utr"]) ?? readNestedString(payload, ["utr"]);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-signature")?.trim() ?? null;

  if (!verifySignature(rawBody, signature)) {
    console.warn("[cashfree-webhook] Signature verification failed.");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = extractEventType(payload) ?? "UNKNOWN_EVENT";
  const transferId = extractTransferId(payload);
  const status = extractStatus(payload);
  const utr = extractUtr(payload);

  if (!transferId) {
    console.warn("[cashfree-webhook] Missing transferId.", { eventType });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const current = await getOfframpRecord(transferId);
  if (!current) {
    await writeOfframpDeadLetter(transferId, rawBody);
    console.warn("[cashfree-webhook] Orphaned webhook routed to DLQ.", { transferId, eventType });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const mappedStatus = mapCashfreeStatusToOfframpStatus(status);
  await updateOfframpRecord(transferId, () => ({
    ...current,
    status:
      mappedStatus === "FAILED" || mappedStatus === "REVERSED"
        ? "REQUIRES_REVIEW"
        : mappedStatus,
    utr: utr ?? current.utr,
    completedAt:
      mappedStatus === "SUCCESS" || mappedStatus === "FAILED" || mappedStatus === "REVERSED"
        ? new Date().toISOString()
        : current.completedAt,
    requiresReview: mappedStatus === "FAILED" || mappedStatus === "REVERSED",
  }));

  return NextResponse.json({ received: true }, { status: 200 });
}
