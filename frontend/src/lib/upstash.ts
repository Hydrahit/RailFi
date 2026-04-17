import "server-only";

import { Redis } from "@upstash/redis";
import { assertNoForbiddenPublicSecrets } from "@/lib/server-env";

let redisSingleton: Redis | null = null;

export function getServerRedis(context: string): Redis {
  assertNoForbiddenPublicSecrets();

  if (redisSingleton) {
    return redisSingleton;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    throw new Error(`Upstash Redis is not configured for ${context}.`);
  }

  redisSingleton = new Redis({ url, token });
  return redisSingleton;
}
