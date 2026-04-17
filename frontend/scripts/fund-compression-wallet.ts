const { Connection, Keypair, LAMPORTS_PER_SOL } = require("@solana/web3.js") as typeof import("@solana/web3.js");
const dotenvLib = require("dotenv") as typeof import("dotenv");

dotenvLib.config({ path: ".env.local" });

const bs58 = require("bs58") as {
  decode(value: string): Uint8Array;
};

export {};

async function main() {
  const rpc =
    process.env.NEXT_PUBLIC_RPC_URL ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    "https://api.devnet.solana.com";
  const secret = process.env.COMPRESSION_SERVICE_KEYPAIR;

  if (!secret) {
    throw new Error("COMPRESSION_SERVICE_KEYPAIR is not set in .env.local");
  }

  const connection = new Connection(rpc, "confirmed");
  const keypair = Keypair.fromSecretKey(bs58.decode(secret));

  console.log(`Compression wallet: ${keypair.publicKey.toBase58()}`);
  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`Current balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.log("Requesting Devnet airdrop (2 SOL)...");
    const signature = await connection.requestAirdrop(
      keypair.publicKey,
      2 * LAMPORTS_PER_SOL,
    );
    const latest = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
      {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed",
    );
    console.log("✅ Airdrop confirmed");
  } else {
    console.log("✅ Balance sufficient");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
