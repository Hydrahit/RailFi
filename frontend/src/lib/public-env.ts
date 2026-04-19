import { PublicKey } from "@solana/web3.js";

export function isBuildPhase(): boolean {
  return (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.npm_lifecycle_event === "build"
  );
}

export function resolvePublicKeyEnv(
  value: string | undefined,
  fallback: string,
  envVarName: string,
  requiredInRuntime = true,
): PublicKey {
  const candidate = value?.trim();
  if (!candidate) {
    if (isBuildPhase()) {
      console.warn(`[solana] ${envVarName} not set during build - using fallback.`);
      return new PublicKey(fallback);
    }

    if (process.env.NODE_ENV !== "production") {
      console.warn(`[solana] ${envVarName} not set - using devnet default.`);
      return new PublicKey(fallback);
    }

    if (requiredInRuntime) {
      throw new Error(
        `[solana] ${envVarName} is not set. Add it to the production environment variables.`,
      );
    }

    console.warn(`[solana] ${envVarName} not set - using fallback.`);
    return new PublicKey(fallback);
  }

  try {
    return new PublicKey(candidate);
  } catch {
    throw new Error(
      `[solana] ${envVarName}="${candidate}" is not a valid base58 public key.`,
    );
  }
}
