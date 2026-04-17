"use client";

import { useEffect, useMemo } from "react";
import { useCountUp } from "@/hooks/useCountUp";
import { cn } from "@/lib/utils";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  formatValue?: (value: number) => string;
  animateKey?: number | string;
  className?: string;
}

export function AnimatedNumber({
  value,
  duration = 1200,
  decimals = 2,
  prefix = "",
  suffix = "",
  formatValue,
  animateKey,
  className,
}: AnimatedNumberProps) {
  const formatter = useMemo(() => {
    return (nextValue: number) =>
      formatValue
        ? formatValue(nextValue)
        : `${prefix}${nextValue.toLocaleString("en-IN", {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          })}${suffix}`;
  }, [decimals, formatValue, prefix, suffix]);

  const { ref, run } = useCountUp(value, duration, formatter);

  useEffect(() => {
    run();
  }, [animateKey, run]);

  return <span ref={ref} className={cn("tabular-nums", className)} />;
}
