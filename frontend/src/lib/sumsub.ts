import "server-only";

import crypto from "crypto";
import type { ComplianceTier } from "@/lib/compliance/types";
import { getServerRedis } from "@/lib/upstash";

const SUMSUB_BASE_URL = process.env.SUMSUB_BASE_URL?.trim() || "https://api.sumsub.com";
const DEMO_SUMSUB_TOKENS = new Set(["test_token"]);
const CIRCUIT_FAILURE_KEY = "sumsub:circuit:failures";
const CIRCUIT_OPEN_KEY = "sumsub:circuit:open";

export class SumsubUpstreamError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "SumsubUpstreamError";
    this.status = status;
  }
}

export interface SumsubApplicant {
  id: string;
  externalUserId?: string;
  review?: {
    reviewStatus?: string;
    levelName?: string;
    reviewResult?: {
      reviewAnswer?: string;
    };
  };
}

export function isSumsubDemoMode(): boolean {
  const appToken = process.env.SUMSUB_APP_TOKEN?.trim();
  return !!appToken && DEMO_SUMSUB_TOKENS.has(appToken);
}

export function isSumsubUpstreamError(error: unknown): error is SumsubUpstreamError {
  return error instanceof SumsubUpstreamError;
}

function getAuthConfig() {
  const appToken = process.env.SUMSUB_APP_TOKEN?.trim();
  const secretKey = process.env.SUMSUB_SECRET_KEY?.trim();
  if (!appToken || !secretKey) {
    throw new Error("Sumsub credentials are not configured.");
  }
  return { appToken, secretKey };
}

function signRequest(ts: string, method: string, pathWithQuery: string, body = ""): string {
  const { secretKey } = getAuthConfig();
  return crypto
    .createHmac("sha256", secretKey)
    .update(`${ts}${method.toUpperCase()}${pathWithQuery}${body}`)
    .digest("hex");
}

// RESILIENCE: All Sumsub calls time out quickly to avoid serverless concurrency exhaustion during upstream brownouts.
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 9000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function isSumsubCircuitOpen(): Promise<boolean> {
  return !!(await getServerRedis("sumsub circuit").get(CIRCUIT_OPEN_KEY));
}

async function recordSumsubFailure(): Promise<void> {
  const redis = getServerRedis("sumsub circuit");
  // RESILIENCE: Circuit breaker trips after repeated failures so callers fail fast while Sumsub recovers.
  const failures = await redis.incr(CIRCUIT_FAILURE_KEY);
  await redis.expire(CIRCUIT_FAILURE_KEY, 60);
  if (failures >= 3) {
    await redis.set(CIRCUIT_OPEN_KEY, "1", { ex: 120 });
    console.error("[sumsub] Circuit breaker OPENED - upstream degraded");
  }
}

async function recordSumsubSuccess(): Promise<void> {
  // RESILIENCE: Clear the failure counter after a good response while letting any open circuit expire naturally.
  await getServerRedis("sumsub circuit").del(CIRCUIT_FAILURE_KEY);
}

async function sumsubFetch<T>(
  method: string,
  pathWithQuery: string,
  body?: Record<string, unknown>,
): Promise<T> {
  // RESILIENCE: Short-circuit immediately if Sumsub is known degraded.
  if (await isSumsubCircuitOpen()) {
    throw new SumsubUpstreamError("Sumsub service temporarily unavailable. Please try again shortly.", null);
  }

  const { appToken } = getAuthConfig();
  const serializedBody = body ? JSON.stringify(body) : "";
  const ts = Math.floor(Date.now() / 1000).toString();
  try {
    const response = await fetchWithTimeout(`${SUMSUB_BASE_URL}${pathWithQuery}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-App-Token": appToken,
        "X-App-Access-Ts": ts,
        "X-App-Access-Sig": signRequest(ts, method, pathWithQuery, serializedBody),
      },
      body: serializedBody || undefined,
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new SumsubUpstreamError(
        `Sumsub request failed (${response.status}): ${text}`,
        response.status,
      );
    }

    await recordSumsubSuccess();
    return (await response.json()) as T;
  } catch (error) {
    await recordSumsubFailure();
    throw error;
  }
}

function levelNameForTier(tier: ComplianceTier): string {
  if (tier === "FULL") {
    return process.env.SUMSUB_LEVEL_NAME_FULL?.trim() || "railfi-full";
  }
  return process.env.SUMSUB_LEVEL_NAME_LITE?.trim() || "railfi-lite";
}

export async function getApplicantByExternalId(
  externalUserId: string,
): Promise<SumsubApplicant | null> {
  try {
    return await sumsubFetch<SumsubApplicant>(
      "GET",
      `/resources/applicants/-;externalUserId=${encodeURIComponent(externalUserId)}/one`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("(404)")) {
      return null;
    }
    throw error;
  }
}

export async function ensureApplicantForWallet(
  externalUserId: string,
  requiredTier: ComplianceTier,
): Promise<SumsubApplicant> {
  const existing = await getApplicantByExternalId(externalUserId);
  if (existing) {
    return existing;
  }

  return sumsubFetch<SumsubApplicant>(
    "POST",
    `/resources/applicants?levelName=${encodeURIComponent(levelNameForTier(requiredTier))}`,
    {
      externalUserId,
      type: "individual",
    },
  );
}

export async function createAccessToken(
  externalUserId: string,
  requiredTier: ComplianceTier,
): Promise<{ token: string; userId: string }> {
  const applicant = await ensureApplicantForWallet(externalUserId, requiredTier);
  const response = await sumsubFetch<{ token: string }>(
    "POST",
    `/resources/accessTokens/sdk?userId=${encodeURIComponent(
      externalUserId,
    )}&levelName=${encodeURIComponent(levelNameForTier(requiredTier))}&ttlInSecs=3600`,
  );
  return {
    token: response.token,
    userId: applicant.id,
  };
}

export function verifyWebhookSignature(rawBody: string, digest: string | null, digestAlg: string | null): boolean {
  const { secretKey } = getAuthConfig();
  if (!digest || !digestAlg) {
    return false;
  }

  const normalizedAlg = digestAlg.toUpperCase();
  const algo =
    normalizedAlg === "HMAC_SHA512_HEX"
      ? "sha512"
      : normalizedAlg === "HMAC_SHA1_HEX"
        ? "sha1"
        : "sha256";
  const expected = crypto.createHmac(algo, secretKey).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(digest));
}
