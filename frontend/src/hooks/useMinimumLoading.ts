"use client";

import { useEffect, useRef, useState } from "react";

export function useMinimumLoading(isLoading: boolean, minimumMs = 300) {
  const [visible, setVisible] = useState(isLoading);
  const startedAtRef = useRef<number | null>(isLoading ? Date.now() : null);

  useEffect(() => {
    if (isLoading) {
      startedAtRef.current = Date.now();
      setVisible(true);
      return;
    }

    if (!visible) {
      return;
    }

    const elapsed = startedAtRef.current ? Date.now() - startedAtRef.current : minimumMs;
    const remaining = Math.max(minimumMs - elapsed, 0);
    const timeout = window.setTimeout(() => setVisible(false), remaining);

    return () => window.clearTimeout(timeout);
  }, [isLoading, minimumMs, visible]);

  return visible;
}
