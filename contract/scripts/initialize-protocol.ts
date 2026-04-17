import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as process from "process";
import dotenv from "dotenv";
import { AnchorProvider, BN, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
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
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const DEFAULT_USDC_MINT = "UmuRwgXdbLqNUfu8rTFyuFuyPBBV1pPiL5FaR145U5F";
const DEFAULT_MERKLE_TREE = "J6bv4QrCsXtZPUv4Wpjf4qknhyjAH7XC1RarysB3L9c9";
const BUBBLEGUM_PROGRAM_ID = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
const PROTOCOL_CONFIG_SEED = Buffer.from("protocol_config_v2");
const LEGACY_PROTOCOL_CONFIG_SPACE = 8 + 32 + 32 + 32 + 32 + 1 + 1;
const ORACLE_AWARE_PROTOCOL_CONFIG_SPACE = LEGACY_PROTOCOL_CONFIG_SPACE + 8;
const CURRENT_PROTOCOL_CONFIG_SPACE = LEGACY_PROTOCOL_CONFIG_SPACE + 32 + 8;

const USDC_MINT = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT ?? DEFAULT_USDC_MINT);
const MERKLE_TREE = new PublicKey(process.env.NEXT_PUBLIC_MERKLE_TREE ?? DEFAULT_MERKLE_TREE);
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet");
const KEYPAIR_PATH = process.env.SOLANA_KEYPAIR_PATH ?? path.join(os.homedir(), ".config", "solana", "id.json");

function resolveRelayerAuthority(): PublicKey {
  const explicit = process.env.RELAYER_AUTHORITY_PUBKEY?.trim();
  if (explicit) {
    return new PublicKey(explicit);
  }

  const relayerSecret = process.env.RELAYER_PRIVATE_KEY?.trim();
  if (relayerSecret) {
    return Keypair.fromSecretKey(bs58.decode(relayerSecret)).publicKey;
  }

  throw new Error(
    "Set RELAYER_AUTHORITY_PUBKEY or RELAYER_PRIVATE_KEY before initializing the protocol.",
  );
}

function resolveKycAuthority(): PublicKey {
  const explicit = process.env.KYC_AUTHORITY_PUBKEY?.trim();
  if (explicit) {
    return new PublicKey(explicit);
  }

  const relayerSecret = process.env.RELAYER_PRIVATE_KEY?.trim();
  if (relayerSecret) {
    return Keypair.fromSecretKey(bs58.decode(relayerSecret)).publicKey;
  }

  throw new Error(
    "Set KYC_AUTHORITY_PUBKEY or RELAYER_PRIVATE_KEY before initializing the protocol with Feature 3.",
  );
}

function resolveKaminoEnabled(): boolean {
  const raw = process.env.KAMINO_ENABLED?.trim().toLowerCase();
  if (!raw) {
    return false;
  }

  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function resolveOracleMaxAge(): number {
  const explicit = process.env.ORACLE_MAX_AGE?.trim();
  if (explicit) {
    const parsed = Number(explicit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("ORACLE_MAX_AGE must be a positive integer.");
    }
    return parsed;
  }

  const rpcLower = RPC_URL.toLowerCase();
  if (rpcLower.includes("mainnet")) {
    return 60;
  }

  return 31_536_000;
}

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
  const programIdFromAnchorToml = readProgramIdFromAnchorToml();
  if (programIdFromAnchorToml) {
    return programIdFromAnchorToml;
  }

  const explicitProgramId = process.env.RAILPAY_PROGRAM_ID ?? process.env.NEXT_PUBLIC_PROGRAM_ID;
  if (explicitProgramId) {
    return new PublicKey(explicitProgramId);
  }

  return new PublicKey(DEFAULT_PROGRAM_ID);
}

const PROGRAM_ID = resolveProgramId();

function withPatchedProtocolInitIdl(source: Idl): Idl {
  const clone = JSON.parse(JSON.stringify(source)) as Idl & {
    instructions?: Array<{
      name: string;
      args?: Array<{ name: string; type: any }>;
      accounts?: Array<{
        name: string;
        isMut?: boolean;
        isSigner?: boolean;
      }>;
    }>;
  };

  for (const instruction of clone.instructions ?? []) {
    if (instruction.name === "initializeProtocol") {
      instruction.args = [
        { name: "relayerAuthority", type: "publicKey" },
        { name: "kycAuthority", type: "publicKey" },
        { name: "kaminoEnabled", type: "bool" },
        { name: "oracleMaxAge", type: "u64" },
      ] as any;
      instruction.accounts = [
        { name: "admin", isMut: true, isSigner: true },
        { name: "railpayProgram", isMut: false, isSigner: false },
        { name: "programData", isMut: false, isSigner: false },
        { name: "protocolConfig", isMut: true, isSigner: false },
        { name: "usdcMint", isMut: false, isSigner: false },
        { name: "merkleTree", isMut: false, isSigner: false },
        { name: "treeConfig", isMut: false, isSigner: false },
        { name: "bubblegumProgram", isMut: false, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ] as any;
    }

    if (instruction.name === "migrateProtocolConfig") {
      instruction.args = [
        { name: "relayerAuthority", type: "publicKey" },
        { name: "oracleMaxAge", type: "u64" },
      ] as any;
    }
  }

  return clone;
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
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new Program(withPatchedProtocolInitIdl(idlJson as Idl), PROGRAM_ID, provider);
  const methods = program.methods as Record<string, (...args: unknown[]) => any>;
  const oracleMaxAge = resolveOracleMaxAge();
  const oracleMaxAgeBn = new BN(oracleMaxAge);

  const [protocolConfig] = PublicKey.findProgramAddressSync([PROTOCOL_CONFIG_SEED], PROGRAM_ID);
  const [programData] = PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  );
  const [treeConfig] = PublicKey.findProgramAddressSync(
    [MERKLE_TREE.toBuffer()],
    BUBBLEGUM_PROGRAM_ID,
  );

  console.log("\nRailPay Protocol Initialization");
  console.log(`RPC:             ${RPC_URL}`);
  console.log(`Program:         ${PROGRAM_ID.toBase58()}`);
  console.log(`Admin:           ${payer.publicKey.toBase58()}`);
  console.log(`Protocol Config: ${protocolConfig.toBase58()}`);
  console.log(`Relayer Auth:    ${resolveRelayerAuthority().toBase58()}`);
  console.log(`USDC Mint:       ${USDC_MINT.toBase58()}`);
  console.log(`Merkle Tree:     ${MERKLE_TREE.toBase58()}`);
  console.log(`KYC Authority:   ${resolveKycAuthority().toBase58()}`);
  console.log(`Kamino Enabled:  ${resolveKaminoEnabled()}`);
  console.log(`Oracle Max Age:  ${oracleMaxAge} sec`);

  const existingAccount = await connection.getAccountInfo(protocolConfig, "confirmed");

  if (!existingAccount) {
    const signature = await methods
      .initializeProtocol(
        resolveRelayerAuthority(),
        resolveKycAuthority(),
        resolveKaminoEnabled(),
        oracleMaxAgeBn,
      )
      .accounts({
        admin: payer.publicKey,
        railpayProgram: PROGRAM_ID,
        programData,
        protocolConfig,
        usdcMint: USDC_MINT,
        merkleTree: MERKLE_TREE,
        treeConfig,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("\nProtocol initialized.");
    console.log(`Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    return;
  }

  if (existingAccount.data.length < CURRENT_PROTOCOL_CONFIG_SPACE) {
    const signature = await methods
      .migrateProtocolConfig(resolveRelayerAuthority(), oracleMaxAgeBn)
      .accounts({
        admin: payer.publicKey,
        protocolConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("\nProtocol config migrated in place.");
    console.log(`Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    return;
  }

  if (existingAccount.data.length !== CURRENT_PROTOCOL_CONFIG_SPACE) {
    throw new Error(
      `Protocol config account has unexpected size ${existingAccount.data.length}. Expected ${CURRENT_PROTOCOL_CONFIG_SPACE}.`,
    );
  }

  const signature = await methods
    .setOracleMaxAge(oracleMaxAgeBn)
    .accounts({
      admin: payer.publicKey,
      protocolConfig,
    })
    .rpc();

  console.log("\nProtocol oracle_max_age updated on the current layout.");
  console.log(`Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nProtocol init failed: ${message}`);
  process.exit(1);
});
