import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as process from "process";
import dotenv from "dotenv";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import idlJson from "../target/idl/railpay_contract.json";

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
const DEFAULT_ORACLE_MAX_AGE = 86_400;
const PROTOCOL_CONFIG_SEED = Buffer.from("protocol_config_v2");
const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  process.env.SOLANA_RPC_URL ??
  clusterApiUrl("devnet");
const KEYPAIR_PATH =
  process.env.SOLANA_KEYPAIR_PATH ?? path.join(os.homedir(), ".config", "solana", "id.json");

function readProgramIdFromAnchorToml(): PublicKey | null {
  const anchorTomlPath = path.resolve(__dirname, "../Anchor.toml");

  if (!fs.existsSync(anchorTomlPath)) {
    return null;
  }

  const anchorToml = fs.readFileSync(anchorTomlPath, "utf8");
  const match = anchorToml.match(/railpay_contract\s*=\s*"([^"]+)"/);

  if (!match) {
    return null;
  }

  try {
    return new PublicKey(match[1]);
  } catch {
    return null;
  }
}

function resolveProgramId(): PublicKey {
  const fromAnchorToml = readProgramIdFromAnchorToml();
  if (fromAnchorToml) {
    return fromAnchorToml;
  }

  const explicit = process.env.RAILPAY_PROGRAM_ID ?? process.env.NEXT_PUBLIC_PROGRAM_ID;
  if (explicit) {
    return new PublicKey(explicit);
  }

  return new PublicKey(DEFAULT_PROGRAM_ID);
}

function resolveOracleMaxAge(): number {
  const explicit = process.env.ORACLE_MAX_AGE?.trim();
  if (!explicit) {
    return DEFAULT_ORACLE_MAX_AGE;
  }

  const parsed = Number(explicit);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("ORACLE_MAX_AGE must be a positive integer.");
  }

  return parsed;
}

function loadKeypair(keypairPath: string): Keypair {
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}`);
  }

  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function main(): Promise<void> {
  const payer = loadKeypair(KEYPAIR_PATH);
  const oracleMaxAge = resolveOracleMaxAge();
  const programId = resolveProgramId();
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new Program(idlJson as never, programId, provider);
  const methods = program.methods as Record<string, (...args: unknown[]) => any>;

  const [protocolConfig] = PublicKey.findProgramAddressSync([PROTOCOL_CONFIG_SEED], programId);

  console.log("\nRailPay Oracle Max Age Update");
  console.log(`RPC:             ${RPC_URL}`);
  console.log(`Program:         ${programId.toBase58()}`);
  console.log(`Admin:           ${payer.publicKey.toBase58()}`);
  console.log(`Protocol Config: ${protocolConfig.toBase58()}`);
  console.log(`New Max Age:     ${oracleMaxAge} sec`);

  const signature = await methods
    .setOracleMaxAge(new BN(oracleMaxAge))
    .accounts({
      admin: payer.publicKey,
      protocolConfig,
    })
    .rpc();

  console.log("\nOracle max age updated.");
  console.log(`Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nOracle max age update failed: ${message}`);
  process.exit(1);
});
