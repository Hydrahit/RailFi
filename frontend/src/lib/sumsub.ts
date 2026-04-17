import "server-only";

import crypto from "crypto";
import type { ComplianceTier } from "@/lib/compliance/types";

const SUMSUB_BASE_URL = process.env.SUMSUB_BASE_URL?.trim() || "https://api.sumsub.com";
const DEMO_SUMSUB_TOKENS = new Set(["test_token"]);

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

async function sumsubFetch<T>(
  method: string,
  pathWithQuery: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { appToken } = getAuthConfig();
  const serializedBody = body ? JSON.stringify(body) : "";
  const ts = Math.floor(Date.now() / 1000).toString();
  const response = await fetch(`${SUMSUB_BASE_URL}${pathWithQuery}`, {
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

  return (await response.json()) as T;
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
