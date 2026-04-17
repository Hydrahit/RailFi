import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as process from "process";
import dotenv from "dotenv";
import { Program, AnchorProvider, Wallet, type Idl, BN } from "@coral-xyz/anchor";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import idlJson from "../../frontend/src/idl/railpay.json";

const bs58 = require("bs58") as {
  decode(value: string): Uint8Array;
};

for (const candidate of [
  process.env.RAILPAY_ENV_PATH,
  path.resolve(__dirname, "../../frontend/.env.local"),
  path.resolve(__dirname, "../../frontend/.env"),
]) {
  if (candidate) {
    dotenv.config({ path: candidate, override: true });
  }
}

const DEFAULT_PROGRAM_ID = "EfjBUSFyCMEVkcbc66Dzj94qRrYcC9ojKrmdWqk4Thin";
const PROTOCOL_CONFIG_SEED = Buffer.from("protocol_config_v2");
const CIRCUIT_BREAKER_SEED = Buffer.from("circuit_breaker");
const RPC_URL =
  process.env.SOLANA_RPC_URL?.trim() ??
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ??
  process.env.HELIUS_RPC_URL?.trim() ??
  clusterApiUrl("mainnet-beta");
const KEYPAIR_PATH =
  process.env.SOLANA_KEYPAIR_PATH ?? path.join(os.homedir(), ".config", "solana", "id.json");

interface ProtocolConfigAccountData {
  admin: PublicKey;
  relayerAuthority: PublicKey;
  usdcMint: PublicKey;
  merkleTree: PublicKey;
  kycAuthority: PublicKey;
  oracleMaxAge: BN;
  kaminoEnabled: boolean;
  bump: number;
}

interface CircuitBreakerAccountData {
  isTripped: boolean;
}

function loadKeypair(keypairPath: string): Keypair {
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}`);
  }

  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function resolveProgramId(): PublicKey {
  const explicit = process.env.RAILPAY_PROGRAM_ID?.trim() ?? process.env.NEXT_PUBLIC_PROGRAM_ID?.trim();
  return new PublicKey(explicit || DEFAULT_PROGRAM_ID);
}

function resolveExpectedRelayerAuthority(): PublicKey {
  const explicit = process.env.RELAYER_AUTHORITY_PUBKEY?.trim();
  if (explicit) {
    return new PublicKey(explicit);
  }

  const relayerSecret = process.env.RELAYER_PRIVATE_KEY?.trim();
  if (relayerSecret) {
    return Keypair.fromSecretKey(bs58.decode(relayerSecret)).publicKey;
  }

  throw new Error("Set RELAYER_AUTHORITY_PUBKEY or RELAYER_PRIVATE_KEY for smoke testing.");
}

function resolveExpectedKycAuthority(): PublicKey {
  const explicit = process.env.KYC_AUTHORITY_PUBKEY?.trim();
  if (explicit) {
    return new PublicKey(explicit);
  }

  return resolveExpectedRelayerAuthority();
}

function resolveExpectedOracleMaxAge(): number {
  const explicit = process.env.ORACLE_MAX_AGE?.trim();
  if (explicit) {
    const parsed = Number(explicit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("ORACLE_MAX_AGE must be a positive integer.");
    }
    return parsed;
  }

  return 60;
}

async function main(): Promise<void> {
  const payer = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new Program(idlJson as Idl, resolveProgramId(), provider);
  const protocolConfigAccount = program.account.protocolConfig as unknown as {
    fetchNullable(address: PublicKey): Promise<ProtocolConfigAccountData | null>;
  };
  const circuitBreakerAccount = program.account.circuitBreaker as unknown as {
    fetchNullable(address: PublicKey): Promise<CircuitBreakerAccountData | null>;
  };

  const expectedUsdcMint = new PublicKey(
    process.env.NEXT_PUBLIC_USDC_MINT?.trim() || "",
  );
  const expectedMerkleTree = new PublicKey(
    process.env.NEXT_PUBLIC_MERKLE_TREE?.trim() || "",
  );
  const expectedRelayerAuthority = resolveExpectedRelayerAuthority();
  const expectedKycAuthority = resolveExpectedKycAuthority();
  const expectedOracleMaxAge = resolveExpectedOracleMaxAge();

  const [protocolConfigPda] = PublicKey.findProgramAddressSync(
    [PROTOCOL_CONFIG_SEED],
    program.programId,
  );
  const [circuitBreakerPda] = PublicKey.findProgramAddressSync(
    [CIRCUIT_BREAKER_SEED],
    program.programId,
  );
  const treasuryAta = getAssociatedTokenAddressSync(expectedUsdcMint, protocolConfigPda, true);

  console.log("\nRailPay Mainnet Smoke Test");
  console.log(`RPC:                ${RPC_URL}`);
  console.log(`Program:            ${program.programId.toBase58()}`);
  console.log(`Admin wallet:       ${payer.publicKey.toBase58()}`);
  console.log(`Protocol Config:    ${protocolConfigPda.toBase58()}`);
  console.log(`Circuit Breaker:    ${circuitBreakerPda.toBase58()}`);
  console.log(`Treasury ATA:       ${treasuryAta.toBase58()}`);

  const protocolConfig = await protocolConfigAccount.fetchNullable(protocolConfigPda);
  if (!protocolConfig) {
    throw new Error(`ProtocolConfig ${protocolConfigPda.toBase58()} is missing.`);
  }

  if (!protocolConfig.admin.equals(payer.publicKey)) {
    throw new Error(
      `ProtocolConfig admin mismatch. Expected ${payer.publicKey.toBase58()}, found ${protocolConfig.admin.toBase58()}.`,
    );
  }

  if (!protocolConfig.relayerAuthority.equals(expectedRelayerAuthority)) {
    throw new Error(
      `relayer_authority mismatch. Expected ${expectedRelayerAuthority.toBase58()}, found ${protocolConfig.relayerAuthority.toBase58()}.`,
    );
  }

  if (!protocolConfig.kycAuthority.equals(expectedKycAuthority)) {
    throw new Error(
      `kyc_authority mismatch. Expected ${expectedKycAuthority.toBase58()}, found ${protocolConfig.kycAuthority.toBase58()}.`,
    );
  }

  if (!protocolConfig.usdcMint.equals(expectedUsdcMint)) {
    throw new Error(
      `usdc_mint mismatch. Expected ${expectedUsdcMint.toBase58()}, found ${protocolConfig.usdcMint.toBase58()}.`,
    );
  }

  if (!protocolConfig.merkleTree.equals(expectedMerkleTree)) {
    throw new Error(
      `merkle_tree mismatch. Expected ${expectedMerkleTree.toBase58()}, found ${protocolConfig.merkleTree.toBase58()}.`,
    );
  }

  if (protocolConfig.oracleMaxAge.toNumber() !== expectedOracleMaxAge) {
    throw new Error(
      `oracle_max_age mismatch. Expected ${expectedOracleMaxAge}, found ${protocolConfig.oracleMaxAge.toNumber()}.`,
    );
  }

  const circuitBreaker = await circuitBreakerAccount.fetchNullable(circuitBreakerPda);
  if (!circuitBreaker) {
    throw new Error(`CircuitBreaker ${circuitBreakerPda.toBase58()} is missing.`);
  }

  if (circuitBreaker.isTripped) {
    throw new Error("Circuit breaker is tripped. Reset or review thresholds before launch.");
  }

  const treasuryAccount = await getAccount(connection, treasuryAta, "confirmed");
  if (!treasuryAccount.owner.equals(protocolConfigPda)) {
    throw new Error(
      `Treasury ATA owner mismatch. Expected ${protocolConfigPda.toBase58()}, found ${treasuryAccount.owner.toBase58()}.`,
    );
  }

  console.log("Protocol config, circuit breaker, and treasury ATA all match expected Mainnet state.");
  console.log(`Smoke test passed at ${new Date().toISOString()}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke test failed: ${message}`);
  process.exit(1);
});
