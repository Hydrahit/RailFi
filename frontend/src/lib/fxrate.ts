import { getServerRedis } from "@/lib/upstash";

const FX_CACHE_KEY = "fx:usd_inr";
const FX_CACHE_TTL_SECONDS = 60;
const FX_FALLBACK_RATE = 84.0;
const FX_TIMEOUT_MS = 5_000;
const COINGECKO_USD_INR_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=inr";

interface CoinGeckoUsdInrResponse {
  tether?: {
    inr?: number;
  };
}

function isValidUsdInrRate(rate: number): boolean {
  return Number.isFinite(rate) && rate >= 50 && rate <= 150;
}

export async function getUsdInrRate(): Promise<{
  rate: number;
  source: "cache" | "coingecko" | "fallback";
}> {
  let cachedRate: number | string | null = null;
  let redis: ReturnType<typeof getServerRedis> | null = null;
  try {
    redis = getServerRedis("USD/INR FX rate");
    cachedRate = await redis.get<number | string>(FX_CACHE_KEY);
  } catch (error: unknown) {
    console.warn("[fxrate] Redis unavailable; continuing without FX cache.", error);
  }
  const parsedCachedRate =
    typeof cachedRate === "number"
      ? cachedRate
      : typeof cachedRate === "string"
        ? Number(cachedRate)
        : Number.NaN;

  if (isValidUsdInrRate(parsedCachedRate)) {
    return { rate: parsedCachedRate, source: "cache" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FX_TIMEOUT_MS);

  try {
    const response = await fetch(COINGECKO_USD_INR_URL, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`CoinGecko FX request failed: ${response.status}`);
    }

    const data = (await response.json()) as CoinGeckoUsdInrResponse;
    const rate = data.tether?.inr;

    if (typeof rate !== "number" || !isValidUsdInrRate(rate)) {
      throw new Error("CoinGecko returned an invalid USD/INR rate");
    }

    if (redis) {
      await redis.setex(FX_CACHE_KEY, FX_CACHE_TTL_SECONDS, rate);
    }
    return { rate, source: "coingecko" };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown FX fetch error";
    console.error("[fxrate] Failed to fetch USD/INR rate, using fallback", {
      error: message,
      fallbackRate: FX_FALLBACK_RATE,
    });
    return { rate: FX_FALLBACK_RATE, source: "fallback" };
  } finally {
    clearTimeout(timeout);
  }
}
