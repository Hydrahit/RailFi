import "server-only";

import { getServerRedis } from "@/lib/upstash";

export async function enforceAuthorizeWalletRateLimit(walletAddress: string | undefined): Promise<void> {
  if (!walletAddress) {
    return;
  }

  // SECURITY: Per-wallet brute-force protection for the credentials authorize path outside edge middleware.
  const walletRateLimitKey = `auth:ratelimit:wallet:${walletAddress}`;
  const redis = getServerRedis("nextauth wallet authorize rate limit");
  const attempts = await redis.incr(walletRateLimitKey);
  await redis.expire(walletRateLimitKey, 60);

  if (attempts > 10) {
    throw new Error("Too many authentication attempts for this wallet. Please try again in 1 minute.");
  }
}
