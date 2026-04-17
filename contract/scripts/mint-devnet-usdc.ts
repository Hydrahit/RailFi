import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as process from "process";
import dotenv from "dotenv";
import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotent,
  getAccount,
  getMint,
  getAssociatedTokenAddressSync,
  mintTo,
} from "@solana/spl-token";

for (const candidate of [
  process.env.RAILPAY_ENV_PATH,
  path.resolve(__dirname, "../../frontend/.env.local"),
  path.resolve(__dirname, "../../frontend/.env"),
]) {
  if (candidate) {
    dotenv.config({ path: candidate, override: true });
  }
}

const DEFAULT_USDC_MINT = "UmuRwgXdbLqNUfu8rTFyuFuyPBBV1pPiL5FaR145U5F";
const DEVNET_USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ?? DEFAULT_USDC_MINT,
);
const RPC_URL = process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet");
const KEYPAIR_PATH = process.env.SOLANA_KEYPAIR_PATH ?? path.join(os.homedir(), ".config", "solana", "id.json");

function loadKeypair(keypairPath: string): Keypair {
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}`);
  }

  const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function parseAmount(rawAmount: string | undefined): number {
  const amount = rawAmount ? Number(rawAmount) : 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be a positive number of USDC.");
  }
  return amount;
}

async function main(): Promise<void> {
  const amountUsdc = parseAmount(process.argv[2]);
  const payer = loadKeypair(KEYPAIR_PATH);
  const recipient = process.argv[3] ? new PublicKey(process.argv[3]) : payer.publicKey;
  const connection = new Connection(RPC_URL, "confirmed");

  console.log("\nRailPay Devnet USDC Funding");
  console.log(`RPC:        ${RPC_URL}`);
  console.log(`Mint:       ${DEVNET_USDC_MINT.toBase58()}`);
  console.log(`Authority:  ${payer.publicKey.toBase58()}`);
  console.log(`Recipient:  ${recipient.toBase58()}`);
  console.log(`Amount:     ${amountUsdc.toFixed(2)} USDC`);

  const mint = await getMint(connection, DEVNET_USDC_MINT, "confirmed");

  if (!mint.mintAuthority) {
    throw new Error("This mint has no mint authority. It cannot mint new test USDC.");
  }

  if (!mint.mintAuthority.equals(payer.publicKey)) {
    throw new Error(
      `Local wallet is not the mint authority. Expected ${mint.mintAuthority.toBase58()}, got ${payer.publicKey.toBase58()}.`,
    );
  }

  const recipientAta = getAssociatedTokenAddressSync(DEVNET_USDC_MINT, recipient);
  await createAssociatedTokenAccountIdempotent(
    connection,
    payer,
    DEVNET_USDC_MINT,
    recipient,
    { commitment: "confirmed" },
  );

  const rawAmount = BigInt(Math.round(amountUsdc * 10 ** mint.decimals));
  const signature = await mintTo(
    connection,
    payer,
    DEVNET_USDC_MINT,
    recipientAta,
    payer,
    rawAmount,
    [],
    { commitment: "confirmed" },
  );

  const recipientAccount = await getAccount(connection, recipientAta, "confirmed");
  const uiBalance = Number(recipientAccount.amount) / 10 ** mint.decimals;

  console.log("\nMint complete.");
  console.log(`Recipient ATA: ${recipientAta.toBase58()}`);
  console.log(`New balance:   ${uiBalance.toFixed(2)} USDC`);
  console.log(`Explorer:      https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFunding failed: ${message}`);
  process.exit(1);
});
