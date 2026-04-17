import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import type { NextRequest } from "next/server";
import { getServerRedis } from "@/lib/upstash";

type LimiterName =
  | "relayPrepareIp"
  | "relaySubmitIp"
  | "relaySubmitWallet"
  | "taxExportWallet"
  | "kycTokenIp"
  | "kycTokenWallet"
  | "kycStatusWallet"
  | "invoiceCreateIp"
  | "invoiceCreateWallet"
  | "invoiceListWallet"
  | "invoicePublicReadIp"
  | "invoiceMarkPaidIp"
  | "invoiceMarkPaidWallet"
  | "invoicePayContextWallet"
  | "walletSessionIp"
  | "webhookArchiveWallet"
  | "validateUpiIp"
  | "yieldIp"
  | "analyticsIp"
  | "compressOfframpIp"
  | "kycWebhookIp"
  | "relayBalanceAlertIp"
  | "heliusWebhookIp"
  | "cashfreeWebhookIp";

interface RatelimitConfig {
  prefix: string;
  limit: number;
}

const LIMITER_CONFIG: Record<LimiterName, RatelimitConfig> = {
  relayPrepareIp: { prefix: "railfi:ratelimit:relay-prepare:ip", limit: 60 },
  relaySubmitIp: { prefix: "railfi:ratelimit:relay:ip", limit: 30 },
  relaySubmitWallet: { prefix: "railfi:ratelimit:relay:wallet", limit: 10 },
  taxExportWallet: { prefix: "railfi:ratelimit:tax-export:wallet", limit: 12 },
  kycTokenIp: { prefix: "railfi:ratelimit:kyc-token:ip", limit: 20 },
  kycTokenWallet: { prefix: "railfi:ratelimit:kyc-token:wallet", limit: 10 },
  kycStatusWallet: { prefix: "railfi:ratelimit:kyc-status:wallet", limit: 120 },
  invoiceCreateIp: { prefix: "railfi:ratelimit:invoice-create:ip", limit: 60 },
  invoiceCreateWallet: { prefix: "railfi:ratelimit:invoice-create:wallet", limit: 20 },
  invoiceListWallet: { prefix: "railfi:ratelimit:invoice-list:wallet", limit: 120 },
  invoicePublicReadIp: { prefix: "railfi:ratelimit:invoice-public:ip", limit: 120 },
  invoiceMarkPaidIp: { prefix: "railfi:ratelimit:invoice-mark-paid:ip", limit: 30 },
  invoiceMarkPaidWallet: { prefix: "railfi:ratelimit:invoice-mark-paid:wallet", limit: 10 },
  invoicePayContextWallet: { prefix: "railfi:ratelimit:invoice-pay-context:wallet", limit: 30 },
  walletSessionIp: { prefix: "railfi:ratelimit:wallet-session:ip", limit: 60 },
  webhookArchiveWallet: { prefix: "railfi:ratelimit:webhook-archive:wallet", limit: 120 },
  validateUpiIp: { prefix: "railfi:ratelimit:validate-upi:ip", limit: 120 },
  yieldIp: { prefix: "railfi:ratelimit:yield:ip", limit: 60 },
  analyticsIp: { prefix: "railfi:ratelimit:analytics:ip", limit: 60 },
  compressOfframpIp: { prefix: "railfi:ratelimit:compress-offramp:ip", limit: 240 },
  kycWebhookIp: { prefix: "railfi:ratelimit:kyc-webhook:ip", limit: 240 },
  relayBalanceAlertIp: { prefix: "railfi:ratelimit:relay-balance-alert:ip", limit: 120 },
  heliusWebhookIp: { prefix: "railfi:ratelimit:helius-webhook:ip", limit: 600 },
  cashfreeWebhookIp: { prefix: "railfi:ratelimit:cashfree-webhook:ip", limit: 600 },
};

const limiterCache = new Map<LimiterName, Ratelimit>();

export interface RateLimitResult {
  allowed: boolean;
  message?: string;
}

function getLimiter(name: LimiterName): Ratelimit {
  const existing = limiterCache.get(name);
  if (existing) {
    return existing;
  }

  const config = LIMITER_CONFIG[name];
  const limiter = new Ratelimit({
    redis: getServerRedis("rate limiting"),
    limiter: Ratelimit.slidingWindow(config.limit, "1 h"),
    prefix: config.prefix,
    analytics: false,
  });
  limiterCache.set(name, limiter);
  return limiter;
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase();
}

export function getClientIpAddress(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

export async function enforceIpRateLimit(
  request: NextRequest,
  name: LimiterName,
  message: string,
): Promise<RateLimitResult> {
  const result = await getLimiter(name).limit(normalizeKeyPart(getClientIpAddress(request)));
  if (!result.success) {
    return {
      allowed: false,
      message,
    };
  }

  return { allowed: true };
}

export async function enforceWalletRateLimit(
  walletAddress: string,
  name: LimiterName,
  message: string,
): Promise<RateLimitResult> {
  const result = await getLimiter(name).limit(normalizeKeyPart(walletAddress));
  if (!result.success) {
    return {
      allowed: false,
      message,
    };
  }

  return { allowed: true };
}
