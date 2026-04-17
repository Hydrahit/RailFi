"use client";

import { useCallback, useEffect, useRef } from "react";

export function useCountUp(
  end: number,
  duration = 1200,
  formatter?: (value: number) => string,
) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const frameRef = useRef<number | null>(null);

  const run = useCallback(() => {
    const el = ref.current;
    if (!el) {
      return;
    }

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }

    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 4);
      const value = end * eased;

      el.textContent = formatter ? formatter(value) : value.toFixed(2);

      if (p < 1) {
        frameRef.current = window.requestAnimationFrame(tick);
      }
    };

    frameRef.current = window.requestAnimationFrame(tick);
  }, [duration, end, formatter]);

  useEffect(() => {
    run();

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [run]);

  return { ref, run };
}
