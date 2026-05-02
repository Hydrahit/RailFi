import { Ratelimit } from "@upstash/ratelimit";
import { NextRequest } from "next/server";
import { auth } from "../../../../../auth";
import { fetchWithTimeout, TIMEOUTS } from "@/lib/fetch-with-timeout";
import { getUsdInrRate } from "@/lib/fxrate";
import { requireTrustedOrigin } from "@/lib/origin";
import { getServerRedis } from "@/lib/upstash";
import { getRefreshedWalletSessionFromRequest } from "@/lib/wallet-session-server";
import type { DodoOfframpIntent } from "@/types/dodo";

export const runtime = "nodejs";

const PYTH_HERMES_URL =
  "https://hermes.pyth.network/v2/updates/price/latest" +
  "?ids[]=0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
const COINGECKO_USDC_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=usd";

const UPI_HANDLE_REGEX = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/;
const MAX_PRICE_DEVIATION_RATIO = 0.01;

interface ClaimRequestBody {
  dodoPaymentId: string;
  upiHandle: string;
}

interface PythParsedPriceFeed {
  id: string;
  price: {
    price: string;
    expo: number;
    conf: string;
    publish_time: number;
  };
}

interface PythHermesResponse {
  parsed: PythParsedPriceFeed[];
}

interface CoinGeckoPriceResponse {
  "usd-coin"?: {
    usd?: number;
  };
}

function getRedis() {
  return getServerRedis("dodo claim");
}

function getClaimLimiter(): Ratelimit {
  return new Ratelimit({
    redis: getServerRedis("dodo claim rate limiting"),
    limiter: Ratelimit.slidingWindow(5, "60 s"),
    prefix: "railfi:ratelimit:dodo-claim:wallet",
    analytics: false,
  });
}

async function fetchPythUsdcPrice(): Promise<number> {
  const res = await fetchWithTimeout(PYTH_HERMES_URL, {
    next: { revalidate: 0 },
    timeoutMs: TIMEOUTS.coingecko,
  });

  if (!res.ok) {
    throw new Error(`Pyth Hermes request failed: ${res.status}`);
  }

  const data = (await res.json()) as PythHermesResponse;
  const feed = data.parsed?.[0];

  if (!feed) {
    throw new Error("Pyth Hermes returned no price feeds");
  }

  const now = Math.floor(Date.now() / 1000);
  const age = now - feed.price.publish_time;
  const maxAgeSeconds = 60;

  if (age > maxAgeSeconds) {
    throw new Error(`Pyth price is stale: ${age}s old (max ${maxAgeSeconds}s)`);
  }

  const rawPrice = parseFloat(feed.price.price);
  const exponent = feed.price.expo;
  const price = rawPrice * Math.pow(10, exponent);
  const conf = parseFloat(feed.price.conf) * Math.pow(10, exponent);
  const maxConfRatio = 0.005;

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Pyth returned an invalid price");
  }

  if (!Number.isFinite(conf) || conf < 0) {
    throw new Error("Pyth returned an invalid confidence interval");
  }

  if (conf / price > maxConfRatio) {
    throw new Error(
      `Pyth confidence interval too wide: ${(conf / price * 100).toFixed(4)}%`,
    );
  }

  return price;
}

async function fetchCoinGeckoUsdcPrice(): Promise<number> {
  const res = await fetchWithTimeout(COINGECKO_USDC_URL, {
    cache: "no-store",
    timeoutMs: TIMEOUTS.coingecko,
  });

  if (!res.ok) {
    throw new Error(`CoinGecko request failed: ${res.status}`);
  }

  const data = (await res.json()) as CoinGeckoPriceResponse;
  const price = data["usd-coin"]?.usd;

  if (!Number.isFinite(price) || typeof price !== "number" || price <= 0) {
    throw new Error("CoinGecko returned an invalid USDC price");
  }

  return price;
}

export async function POST(request: NextRequest): Promise<Response> {
  const originViolation = requireTrustedOrigin(request);
  if (originViolation) {
    return originViolation;
  }

  const [session, walletSession] = await Promise.all([
    auth(),
    getRefreshedWalletSessionFromRequest(request),
  ]);

  if (!session?.user?.email) {
    return Response.json(
      {
        error:
          "Google sign-in required. Sign in with the Dodo customer email before claiming this intent.",
      },
      { status: 401 },
    );
  }

  const walletAddress = session.user.walletAddress ?? walletSession?.walletAddress ?? null;

  if (!walletAddress) {
    return Response.json(
      {
        error:
          "Wallet session required. Connect your Solana wallet and approve the signature before claiming.",
      },
      { status: 403 },
    );
  }

  const rateLimit = await getClaimLimiter().limit(walletAddress.trim().toLowerCase());

  if (!rateLimit.success) {
    return Response.json(
      { error: "Too many requests. Please wait before retrying." },
      { status: 429 },
    );
  }

  let body: ClaimRequestBody;
  try {
    body = (await request.json()) as ClaimRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const dodoPaymentId = body.dodoPaymentId?.trim();
  const upiHandle = body.upiHandle?.trim();

  if (!dodoPaymentId) {
    return Response.json({ error: "dodoPaymentId is required" }, { status: 400 });
  }

  if (!upiHandle || !UPI_HANDLE_REGEX.test(upiHandle)) {
    return Response.json(
      { error: "Invalid UPI handle format. Expected format: handle@provider" },
      { status: 400 },
    );
  }

  const redisKey = `railfi:dodo:intent:${dodoPaymentId}`;
  const redis = getRedis();
  const intent = await redis.get<DodoOfframpIntent>(redisKey);

  if (!intent) {
    return Response.json(
      { error: "Payment intent not found or has expired." },
      { status: 404 },
    );
  }

  if (intent.status !== "PENDING_WALLET_LINK") {
    return Response.json(
      {
        error: `Intent is already in status "${intent.status}". Cannot re-claim.`,
        transferId: intent.transferId ?? null,
      },
      { status: 409 },
    );
  }

  if (intent.customerEmail.toLowerCase() !== session.user.email.toLowerCase()) {
    console.warn("[dodo/claim] Email mismatch attempt", {
      sessionEmail: session.user.email,
      intentEmail: intent.customerEmail,
      wallet: walletAddress,
    });
    return new Response("Forbidden", { status: 403 });
  }

  let usdcPrice: number;
  let coingeckoUsdcPrice: number;
  try {
    [usdcPrice, coingeckoUsdcPrice] = await Promise.all([
      fetchPythUsdcPrice(),
      fetchCoinGeckoUsdcPrice(),
    ]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown Pyth error";
    console.error("[dodo/claim] Oracle validation failed:", message);
    return Response.json(
      { error: `Oracle unavailable: ${message}` },
      { status: 503 },
    );
  }

  const priceDeviationRatio = Math.abs(usdcPrice - coingeckoUsdcPrice) / coingeckoUsdcPrice;
  console.info("[dodo/claim] Oracle comparison", {
    dodoPaymentId,
    pythUsdcPrice: usdcPrice,
    coinGeckoUsdcPrice: coingeckoUsdcPrice,
    priceDeviationRatio,
  });

  if (priceDeviationRatio > MAX_PRICE_DEVIATION_RATIO) {
    return Response.json(
      {
        error:
          `Oracle deviation too wide: ${(priceDeviationRatio * 100).toFixed(4)}%. ` +
          "Quote denied to protect against a bad fill.",
      },
      { status: 503 },
    );
  }

  const usdcAmount = Math.floor((intent.amountUsd / usdcPrice) * 1_000_000);
  const { rate: usdInrIndicative } = await getUsdInrRate();
  const inrQuote = Math.floor(intent.amountUsd * usdInrIndicative * 100);
  const updatedIntent: DodoOfframpIntent = {
    ...intent,
    walletAddress,
    upiHandle: upiHandle.toLowerCase(),
    usdcAmount,
    inrQuote,
    status: "READY_FOR_RELAY",
    claimedAt: Date.now(),
  };

  await redis.setex(redisKey, 86400, updatedIntent);

  console.info("[dodo/claim] Intent claimed and ready for relay", {
    dodoPaymentId,
    walletAddress,
    usdcAmount,
    upiHandle: updatedIntent.upiHandle,
  });

  return Response.json({
    dodoPaymentId,
    usdcAmount,
    usdcAmountFormatted: (usdcAmount / 1_000_000).toFixed(6),
    inrQuoteIndicative: inrQuote,
    status: "READY_FOR_RELAY",
  });
}
