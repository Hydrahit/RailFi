"use client";

import { useEffect, useState } from "react";

interface YieldReferenceResponse {
  benchmarkUsdInr?: number;
}

export function useUsdInrReference(): number | null {
  const [rate, setRate] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRate() {
      try {
        const response = await fetch("/api/yield", {
          method: "GET",
          cache: "force-cache",
        });
        const payload = (await response.json()) as YieldReferenceResponse;

        if (
          response.ok &&
          typeof payload.benchmarkUsdInr === "number" &&
          Number.isFinite(payload.benchmarkUsdInr)
        ) {
          if (!cancelled) {
            setRate(payload.benchmarkUsdInr);
          }
        }
      } catch {
        if (!cancelled) {
          setRate(null);
        }
      }
    }

    void loadRate();

    return () => {
      cancelled = true;
    };
  }, []);

  return rate;
}
