// ─── lib/utils.ts ─────────────────────────────────────────────────────────────
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes safely — no conflicts, no duplicates */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format micro-USDC (u64) → human-readable USDC string */
export function formatUsdc(microUsdc: number | bigint, decimals = 2): string {
  const n = typeof microUsdc === "bigint" ? Number(microUsdc) : microUsdc;
  return (n / 1_000_000).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format paise → INR string with ₹ symbol */
export function formatInr(paise: number | bigint): string {
  const n = typeof paise === "bigint" ? Number(paise) : paise;
  return `₹${(n / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Shorten a Solana address for display */
export function shortAddress(address: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/** Devnet Explorer URL for a transaction */
export function explorerUrl(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

/** Sleep helper */
export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Convert u8[32] to UTF-8 string (strips null bytes) */
export function bytesToString(bytes: number[]): string {
  const nullIdx = bytes.indexOf(0);
  const slice = nullIdx === -1 ? bytes : bytes.slice(0, nullIdx);
  return Buffer.from(slice).toString("utf8");
}

/** Relative time (e.g. "2 min ago") */
export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const min  = Math.floor(diff / 60_000);
  const hr   = Math.floor(diff / 3_600_000);
  const day  = Math.floor(diff / 86_400_000);
  if (min < 1)  return "just now";
  if (min < 60) return `${min} min ago`;
  if (hr  < 24) return `${hr}h ago`;
  return `${day}d ago`;
}
