import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsSnapshot } from "@/lib/analytics";
import { enforceIpRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const revalidate = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const ipLimit = await enforceIpRateLimit(
    request,
    "analyticsIp",
    "Analytics rate limit exceeded for this IP.",
  );
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: ipLimit.message }, { status: 429 });
  }

  try {
    const snapshot = await getAnalyticsSnapshot();
    return NextResponse.json(snapshot, {
      status: 200,
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("[analytics] failed:", error);
    return NextResponse.json(
      { error: "Failed to load analytics snapshot." },
      { status: 502 },
    );
  }
}
