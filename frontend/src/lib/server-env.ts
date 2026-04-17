import "server-only";

import { clusterApiUrl } from "@solana/web3.js";

const FORBIDDEN_PUBLIC_ENV_NAMES = [
  "NEXT_PUBLIC_HELIUS_API_KEY",
];

const FORBIDDEN_PUBLIC_ENV_FRAGMENTS = ["SUMSUB", "UPSTASH", "PRIVATE_KEY", "SECRET"];
const SENSITIVE_PUBLIC_VALUE_PATTERNS = [/api-key=/i, /apikey=/i, /token=/i, /secret=/i];

let checkedPublicEnv = false;

export function assertNoForbiddenPublicSecrets(): void {
  if (checkedPublicEnv) {
    return;
  }

  for (const [key, rawValue] of Object.entries(process.env)) {
    if (!key.startsWith("NEXT_PUBLIC_")) {
      continue;
    }

    const value = rawValue?.trim();
    if (!value) {
      continue;
    }

    if (FORBIDDEN_PUBLIC_ENV_NAMES.includes(key)) {
      throw new Error(
        `[security] ${key} must not be exposed to the browser. Move it to a server-only environment variable.`,
      );
    }

    if (FORBIDDEN_PUBLIC_ENV_FRAGMENTS.some((fragment) => key.includes(fragment))) {
      throw new Error(
        `[security] ${key} must not use the NEXT_PUBLIC_ prefix. Sensitive provider secrets must remain server-only.`,
      );
    }

    if (SENSITIVE_PUBLIC_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new Error(
        `[security] ${key} contains a secret-bearing URL or tokenized value. Use a server-only env var instead.`,
      );
    }
  }

  checkedPublicEnv = true;
}

export function getServerHeliusApiKey(): string {
  assertNoForbiddenPublicSecrets();
  const apiKey = process.env.HELIUS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("HELIUS_API_KEY is not configured.");
  }
  return apiKey;
}

export function getServerHeliusRpcUrl(): string {
  assertNoForbiddenPublicSecrets();
  const rpcUrl = process.env.HELIUS_RPC_URL?.trim();
  if (!rpcUrl) {
    throw new Error("HELIUS_RPC_URL is not configured.");
  }
  return rpcUrl;
}

export function getServerSolanaRpcUrl(): string {
  assertNoForbiddenPublicSecrets();
  return (
    process.env.SOLANA_RPC_URL?.trim() ??
    process.env.HELIUS_RPC_URL?.trim() ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ??
    process.env.NEXT_PUBLIC_RPC_URL?.trim() ??
    clusterApiUrl("devnet")
  );
}

export function getServerLightRpcUrl(): string {
  assertNoForbiddenPublicSecrets();
  return (
    process.env.LIGHT_RPC_URL?.trim() ??
    process.env.HELIUS_RPC_URL?.trim() ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ??
    process.env.NEXT_PUBLIC_RPC_URL?.trim() ??
    "https://api.devnet.solana.com"
  );
}
