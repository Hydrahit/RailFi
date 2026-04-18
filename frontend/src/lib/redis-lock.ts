import "server-only";

import { getServerRedis } from "@/lib/upstash";

const DEFAULT_LOCK_TTL_SECONDS = 120;

export async function acquireLock(
  resource: string,
  ownerToken: string,
  ttlSeconds: number = DEFAULT_LOCK_TTL_SECONDS,
): Promise<boolean> {
  const redis = getServerRedis("redis lock");
  const result = await redis.set(resource, ownerToken, {
    nx: true,
    ex: ttlSeconds,
  });
  return result !== null;
}

export async function releaseLock(
  resource: string,
  ownerToken: string,
): Promise<boolean> {
  const redis = getServerRedis("redis lock");
  const result = await redis.eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
    [resource],
    [ownerToken],
  );
  return result === 1;
}

export async function refreshLock(
  resource: string,
  ownerToken: string,
  ttlSeconds: number = DEFAULT_LOCK_TTL_SECONDS,
): Promise<boolean> {
  const redis = getServerRedis("redis lock");
  const result = await redis.eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) else return 0 end",
    [resource],
    [ownerToken, String(ttlSeconds)],
  );
  return result === 1;
}
