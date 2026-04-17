import "server-only";

import type { OfframpRecord } from "@/types/helius";
import { getServerRedis } from "@/lib/upstash";

const EVENT_LOG_KEY = "railfi:webhook:event-log";
const RECORD_TTL_SECONDS = 60 * 60 * 24 * 365 * 2;

function recordKey(requestId: string): string {
  return `railfi:webhook:record:${requestId}`;
}

function walletKey(walletAddress: string): string {
  return `railfi:webhook:wallet:${walletAddress}`;
}

export async function appendWebhookEvent(eventData: unknown): Promise<void> {
  try {
    const redis = getServerRedis("webhook storage");
    const payload = JSON.stringify({
      receivedAt: Date.now(),
      eventData,
    });
    await Promise.all([
      redis.lpush(EVENT_LOG_KEY, payload),
      redis.ltrim(EVENT_LOG_KEY, 0, 999),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Redis write error.";
    console.error("[webhook-store] appendWebhookEvent failed.", {
      message,
    });
    throw new Error(`Failed to append webhook event: ${message}`);
  }
}

export async function upsertWebhookRecord(record: OfframpRecord): Promise<void> {
  try {
    const redis = getServerRedis("webhook storage");
    await Promise.all([
      redis.setex(recordKey(record.requestId), RECORD_TTL_SECONDS, record),
      redis.zadd(walletKey(record.walletAddress), {
        score: record.receivedAt,
        member: record.requestId,
      }),
      redis.expire(walletKey(record.walletAddress), RECORD_TTL_SECONDS),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Redis write error.";
    console.error("[webhook-store] upsertWebhookRecord failed.", {
      requestId: record.requestId,
      walletAddress: record.walletAddress,
      message,
    });
    throw new Error(`Failed to upsert webhook record: ${message}`);
  }
}

export async function getWebhookRecordsByWallet(walletAddress: string): Promise<OfframpRecord[]> {
  try {
    const redis = getServerRedis("webhook storage");
    const requestIds = await redis.zrange<string[]>(walletKey(walletAddress), 0, -1);
    if (!requestIds || requestIds.length === 0) {
      return [];
    }

    const records = await Promise.all(
      requestIds.map((requestId) => redis.get<OfframpRecord>(recordKey(requestId))),
    );
    const deadIds = requestIds.filter((_, index) => !records[index]);
    if (deadIds.length > 0) {
      try {
        await redis.zrem(walletKey(walletAddress), ...deadIds);
      } catch (cleanupError) {
        const cleanupMessage =
          cleanupError instanceof Error ? cleanupError.message : "Unknown Redis cleanup error.";
        console.error("[webhook-store] Failed to prune dead webhook record ids.", {
          walletAddress,
          deadIds,
          message: cleanupMessage,
        });
      }
    }

    return records
      .filter((record): record is OfframpRecord => record !== null)
      .sort((a, b) => b.receivedAt - a.receivedAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Redis read error.";
    console.error("[webhook-store] getWebhookRecordsByWallet failed.", {
      walletAddress,
      message,
    });
    throw new Error(`Failed to read webhook records: ${message}`);
  }
}
