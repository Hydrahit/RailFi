import { NextRequest, NextResponse } from "next/server";
import { getYieldFallbackSnapshot, getYieldSnapshot } from "@/lib/yield";
import { enforceIpRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const revalidate = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const ipLimit = await enforceIpRateLimit(
    request,
    "yieldIp",
    "Yield benchmark rate limit exceeded for this IP.",
  );
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: ipLimit.message }, { status: 429 });
  }

  try {
    const snapshot = await getYieldSnapshot();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("[yield] failed:", error);
    return NextResponse.json(getYieldFallbackSnapshot(), {
      status: 200,
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
        "X-RailFi-Yield-Fallback": "1",
      },
    });
  }
}
