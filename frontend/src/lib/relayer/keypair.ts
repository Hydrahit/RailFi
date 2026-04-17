import "server-only";

import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { assertNoForbiddenPublicSecrets, getServerHeliusRpcUrl } from "@/lib/server-env";

let cachedRelayerKeypair: Keypair | null = null;

assertNoForbiddenPublicSecrets();

// DEVNET ONLY: hot key. Mainnet requires hardware wallet or multisig custody.
export function loadRelayerKeypair(): Keypair {
  if (cachedRelayerKeypair) {
    return cachedRelayerKeypair;
  }

  const secret = process.env.RELAYER_PRIVATE_KEY?.trim();
  if (!secret) {
    throw new Error("RELAYER_PRIVATE_KEY not set");
  }

  cachedRelayerKeypair = Keypair.fromSecretKey(bs58.decode(secret));
  return cachedRelayerKeypair;
}

export function isRelayEnabled(): boolean {
  return (
    process.env.RELAY_ENABLED !== "false" &&
    !!process.env.RELAYER_PRIVATE_KEY?.trim()
  );
}

export function getRelayRpcUrl(): string {
  return getServerHeliusRpcUrl();
}
