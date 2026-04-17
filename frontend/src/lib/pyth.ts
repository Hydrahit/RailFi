import { Buffer } from "buffer";
import { HermesClient } from "@pythnetwork/hermes-client";
import { useEffect, useRef, useState } from "react";

const HERMES_URL = "https://hermes.pyth.network";
const STREAM_RETRY_BASE_MS = 1000;
const STREAM_RETRY_MAX_MS = 15000;
const DEVNET_STALE_AFTER_SECONDS = 24 * 60 * 60;

// Hex Price Feed IDs — used by Hermes API (NOT Solana pubkeys)
// Source: https://pyth.network/developers/price-feed-ids
export const PYTH_FEED_IDS = {
  USDC_USD: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  USD_INR: "0ac0f9a2886fc2dd708bc66cc2cea359052ce89d324f45d95fadbc6c4fcf1809",
} as const;

export interface PythPrice {
  price: number;
  confidence: number;
  publishTime: number;
  isStale: boolean;
  rawMantissa: number;
  expo: number;
}

interface ParsedPricePayload {
  price: {
    expo: number;
    price: string | number;
    conf: string | number;
    publish_time: number;
  };
}

interface HermesLatestPriceResponse {
  parsed?: ParsedPricePayload[];
}

function parseParsedPrice(parsed: ParsedPricePayload): PythPrice {
  const expo = parsed.price.expo as number;
  const mantissa = Number(parsed.price.price);
  const conf = Number(parsed.price.conf);
  const scale = Math.pow(10, Math.abs(expo));
  const publishTime = parsed.price.publish_time as number;

  return {
    price: mantissa / scale,
    confidence: conf / scale,
    publishTime,
    isStale: Date.now() / 1000 - publishTime > DEVNET_STALE_AFTER_SECONDS,
    rawMantissa: mantissa,
    expo,
  };
}

async function fetchLatestPriceFallback(feedId: string): Promise<PythPrice | null> {
  const response = await fetch(
    `${HERMES_URL}/v2/updates/price/latest?ids[]=${encodeURIComponent(`0x${feedId}`)}&parsed=true`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`Hermes REST fallback failed with ${response.status}`);
  }

  const payload = (await response.json()) as HermesLatestPriceResponse;
  const parsed = payload.parsed?.[0];

  return parsed ? parseParsedPrice(parsed) : null;
}

export function usePythPrice(feedId: string): {
  data: PythPrice | null;
  isLoading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<PythPrice | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectNowRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    activeRef.current = true;
    const client = new HermesClient(HERMES_URL);
    let pollId: number | null = null;

    async function hydrateFromRestFallback() {
      try {
        const fallbackPrice = await fetchLatestPriceFallback(feedId);
        if (!activeRef.current) {
          return;
        }

        if (fallbackPrice) {
          setData(fallbackPrice);
          setError(null);
        } else {
          setError("Pyth rate feed temporarily unavailable");
        }
      } catch {
        if (activeRef.current) {
          setError("Failed to connect to Pyth Hermes");
        }
      } finally {
        if (activeRef.current) {
          setIsLoading(false);
        }
      }
    }

    function clearReconnectTimer() {
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    }

    function ensureFallbackPolling() {
      if (pollId !== null) {
        return;
      }

      pollId = window.setInterval(() => {
        void hydrateFromRestFallback();
      }, 15000);
    }

    function stopFallbackPolling() {
      if (pollId !== null) {
        window.clearInterval(pollId);
        pollId = null;
      }
    }

    function scheduleReconnect() {
      if (!activeRef.current) {
        return;
      }

      clearReconnectTimer();
      const delay = Math.min(
        STREAM_RETRY_BASE_MS * 2 ** reconnectAttemptsRef.current,
        STREAM_RETRY_MAX_MS,
      );
      reconnectAttemptsRef.current += 1;

      reconnectTimeoutRef.current = window.setTimeout(() => {
        void connectStream();
      }, delay);
    }

    async function connectStream() {
      if (!activeRef.current) {
        return;
      }

      clearReconnectTimer();

      try {
        const initial = await client.getLatestPriceUpdates([`0x${feedId}`], {
          parsed: true,
          encoding: "hex",
        });

        if (activeRef.current && initial.parsed?.[0]) {
          setData(parseParsedPrice(initial.parsed[0]));
          setIsLoading(false);
          setError(null);
        } else {
          await hydrateFromRestFallback();
        }

        stopFallbackPolling();

        const stream = await client.getPriceUpdatesStream([`0x${feedId}`], {
          parsed: true,
          encoding: "hex",
        });

        reconnectAttemptsRef.current = 0;

        for await (const update of stream) {
          if (!activeRef.current) {
            break;
          }

          const parsed = update.parsed?.[0];
          if (parsed) {
            setData(parseParsedPrice(parsed));
            setIsLoading(false);
            setError(null);
            reconnectAttemptsRef.current = 0;
          }
        }

        if (activeRef.current) {
          ensureFallbackPolling();
          await hydrateFromRestFallback();
          scheduleReconnect();
        }
      } catch {
        await hydrateFromRestFallback();

        if (activeRef.current) {
          ensureFallbackPolling();
          scheduleReconnect();
        }
      }
    }

    async function reconnectNow() {
      reconnectAttemptsRef.current = 0;
      await hydrateFromRestFallback();
      void connectStream();
    }

    reconnectNowRef.current = () => {
      void reconnectNow();
    };

    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && activeRef.current) {
        reconnectNowRef.current?.();
      }
    }

    function handleOnline() {
      if (activeRef.current) {
        reconnectNowRef.current?.();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    void connectStream();

    return () => {
      activeRef.current = false;
      reconnectNowRef.current = null;
      clearReconnectTimer();
      stopFallbackPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [feedId]);

  return { data, isLoading, error };
}

export async function fetchLatestPriceUpdateVaa(feedId: string): Promise<Uint8Array> {
  const client = new HermesClient(HERMES_URL);
  const result = await client.getLatestPriceUpdates([`0x${feedId}`], {
    encoding: "base64",
    parsed: false,
  });

  if (!result.binary?.data?.[0]) {
    throw new Error("No VAA data returned from Hermes");
  }

  return Buffer.from(result.binary.data[0], "base64");
}
