import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as process from "process";
import dotenv from "dotenv";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const bs58 = require("bs58") as {
  decode: (value: string) => Uint8Array;
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
const DEFAULT_USDC_MINT = "UmuRwgXdbLqNUfu8rTFyuFuyPBBV1pPiL5FaR145U5F";
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

function resolveUsdcMint(): PublicKey {
  return new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT ?? DEFAULT_USDC_MINT);
}

function loadKeypairFromPath(keypairPath: string): Keypair {
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}`);
  }

  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function resolveFundingKeypair(): { keypair: Keypair; source: string } {
  const relayerSecret = process.env.RELAYER_PRIVATE_KEY?.trim();
  if (relayerSecret) {
    return {
      keypair: Keypair.fromSecretKey(bs58.decode(relayerSecret)),
      source: "RELAYER_PRIVATE_KEY",
    };
  }

  return {
    keypair: loadKeypairFromPath(KEYPAIR_PATH),
    source: `SOLANA_KEYPAIR_PATH (${KEYPAIR_PATH})`,
  };
}

async function main(): Promise<void> {
  const { keypair: payer, source } = resolveFundingKeypair();
  const programId = resolveProgramId();
  const usdcMint = resolveUsdcMint();
  const connection = new Connection(RPC_URL, "confirmed");
  const [protocolConfigPda] = PublicKey.findProgramAddressSync(
    [PROTOCOL_CONFIG_SEED],
    programId,
  );
  const treasuryAta = getAssociatedTokenAddressSync(usdcMint, protocolConfigPda, true);

  console.log("\nRailPay Treasury ATA Initialization");
  console.log(`RPC:               ${RPC_URL}`);
  console.log(`Program:           ${programId.toBase58()}`);
  console.log(`Funding wallet:    ${payer.publicKey.toBase58()}`);
  console.log(`Funding source:    ${source}`);
  console.log(`Protocol config:   ${protocolConfigPda.toBase58()}`);
  console.log(`USDC mint:         ${usdcMint.toBase58()}`);
  console.log(`Treasury ATA:      ${treasuryAta.toBase58()}`);

  const protocolConfigInfo = await connection.getAccountInfo(protocolConfigPda, "confirmed");
  if (!protocolConfigInfo) {
    throw new Error(
      `ProtocolConfig PDA ${protocolConfigPda.toBase58()} is not initialized. Run initialize-protocol.ts first.`,
    );
  }

  const existingTreasuryAta = await connection.getAccountInfo(treasuryAta, "confirmed");
  if (existingTreasuryAta) {
    const tokenAccount = await getAccount(connection, treasuryAta, "confirmed");
    console.log("\nTreasury ATA already exists.");
    console.log(`Owner:             ${tokenAccount.owner.toBase58()}`);
    console.log(`Balance:           ${Number(tokenAccount.amount) / 1_000_000} USDC`);
    return;
  }

  const transaction = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      treasuryAta,
      protocolConfigPda,
      usdcMint,
    ),
  );

  const signature = await connection.sendTransaction(transaction, [payer], {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  await connection.confirmTransaction(signature, "confirmed");

  console.log("\nTreasury ATA created.");
  console.log(`Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nTreasury ATA init failed: ${message}`);
  process.exit(1);
});
