import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as process from "process";
import dotenv from "dotenv";
import { clusterApiUrl, Keypair as Web3JsKeypair, PublicKey as Web3JsPublicKey } from "@solana/web3.js";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { createSignerFromKeypair, keypairIdentity, publicKey } from "@metaplex-foundation/umi";
import {
  createTree,
  createTreeConfig,
  fetchTreeConfigFromSeeds,
  mplBubblegum,
  setTreeDelegate,
} from "@metaplex-foundation/mpl-bubblegum";
import { fromWeb3JsKeypair } from "@metaplex-foundation/umi-web3js-adapters";

for (const candidate of [
  process.env.RAILPAY_ENV_PATH,
  path.resolve(__dirname, "../../frontend/.env.local"),
  path.resolve(__dirname, "../../frontend/.env"),
]) {
  if (candidate) {
    dotenv.config({ path: candidate, override: true });
  }
}

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl("devnet");
const KEYPAIR_PATH = process.env.SOLANA_KEYPAIR_PATH ?? path.join(os.homedir(), ".config", "solana", "id.json");
const MERKLE_TREE_KEYPAIR_PATH = path.resolve(__dirname, "../keys/merkle-tree.json");
const MAX_DEPTH = 14;
const MAX_BUFFER_SIZE = 64;
const CANOPY_DEPTH = 0;
const DEFAULT_PROGRAM_ID = "EfjBUSFyCMEVkcbc66Dzj94qRrYcC9ojKrmdWqk4Thin";
const PROTOCOL_CONFIG_SEED = Buffer.from("protocol_config_v2");

function loadWeb3Keypair(filePath: string): Web3JsKeypair {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Keypair not found at ${filePath}`);
  }

  const secret = JSON.parse(fs.readFileSync(filePath, "utf8")) as number[];
  return Web3JsKeypair.fromSecretKey(Uint8Array.from(secret));
}

async function main(): Promise<void> {
  const payer = loadWeb3Keypair(KEYPAIR_PATH);
  const merkleTree = loadWeb3Keypair(MERKLE_TREE_KEYPAIR_PATH);
  const programId = new Web3JsPublicKey(
    process.env.NEXT_PUBLIC_PROGRAM_ID?.trim() || DEFAULT_PROGRAM_ID,
  );
  const [protocolConfigPda] = Web3JsPublicKey.findProgramAddressSync(
    [PROTOCOL_CONFIG_SEED],
    programId,
  );

  const configuredMerkleTree = process.env.NEXT_PUBLIC_MERKLE_TREE?.trim();
  if (configuredMerkleTree && configuredMerkleTree !== merkleTree.publicKey.toBase58()) {
    throw new Error(
      `keys/merkle-tree.json does not match NEXT_PUBLIC_MERKLE_TREE. Expected ${configuredMerkleTree}, got ${merkleTree.publicKey.toBase58()}.`,
    );
  }

  const umi = createUmi(RPC_URL).use(mplBubblegum());
  umi.use(keypairIdentity(fromWeb3JsKeypair(payer)));
  const merkleTreeSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(merkleTree));

  const payerBalance = await umi.rpc.getBalance(umi.identity.publicKey);
  const balanceSol = Number(payerBalance.basisPoints) / 1_000_000_000;

  console.log("\nRailPay Merkle Tree Creation");
  console.log(`RPC:         ${RPC_URL}`);
  console.log(`Payer:       ${payer.publicKey.toBase58()}`);
  console.log(`Tree:        ${merkleTree.publicKey.toBase58()}`);
  console.log(`Program:     ${programId.toBase58()}`);
  console.log(`Protocol:    ${protocolConfigPda.toBase58()}`);
  console.log(`Max Depth:   ${MAX_DEPTH}`);
  console.log(`Max Buffer:  ${MAX_BUFFER_SIZE}`);
  console.log(`Payer SOL:   ${balanceSol.toFixed(4)}`);

  if (balanceSol < 0.5) {
    throw new Error("Need at least 0.5 SOL to create the tree account on Devnet.");
  }

  const merkleTreeAddress = publicKey(merkleTree.publicKey.toBase58());
  const protocolConfigAddress = publicKey(protocolConfigPda.toBase58());
  const merkleTreeAccount = await umi.rpc.getAccount(merkleTreeAddress);
  const protocolConfigAccount = await umi.rpc.getAccount(protocolConfigAddress);

  if (!protocolConfigAccount.exists) {
    throw new Error(
      `Protocol config PDA ${protocolConfigPda.toBase58()} is not initialized yet. Run init:protocol first.`,
    );
  }

  if (!merkleTreeAccount.exists) {
    const builder = await createTree(umi, {
      merkleTree: merkleTreeSigner,
      maxDepth: MAX_DEPTH,
      maxBufferSize: MAX_BUFFER_SIZE,
      canopyDepth: CANOPY_DEPTH,
    });

    const { signature } = await builder.sendAndConfirm(umi, {
      confirm: { commitment: "confirmed" },
    });

    console.log("\nMerkle tree account and tree config created.");
    console.log(`Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  } else {
    console.log("\nMerkle tree account already exists. Reusing it.");
  }

  let treeConfig = await fetchTreeConfigState(umi, merkleTree.publicKey.toBase58());
  if (!treeConfig) {
    const { signature } = await createTreeConfig(umi, {
      merkleTree: merkleTreeAddress,
      maxDepth: MAX_DEPTH,
      maxBufferSize: MAX_BUFFER_SIZE,
      treeCreator: umi.identity,
    }).sendAndConfirm(umi, {
      confirm: { commitment: "confirmed" },
    });

    console.log("Tree authority PDA initialized.");
    console.log(`Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    treeConfig = await fetchTreeConfigState(umi, merkleTree.publicKey.toBase58());
  }

  if (!treeConfig) {
    throw new Error("Bubblegum tree config is still missing after initialization.");
  }

  const treeCreator = treeConfig.treeCreator.toString();
  if (treeCreator !== umi.identity.publicKey.toString()) {
    throw new Error(
      `Tree creator is ${treeCreator}, but the connected payer is ${umi.identity.publicKey.toString()}. Switch to the tree creator wallet before delegating the tree.`,
    );
  }

  const currentDelegate = treeConfig.treeDelegate.toString();
  if (currentDelegate !== protocolConfigPda.toBase58()) {
    const { signature } = await setTreeDelegate(umi, {
      merkleTree: merkleTreeAddress,
      treeCreator: umi.identity,
      newTreeDelegate: protocolConfigAddress,
    }).sendAndConfirm(umi, {
      confirm: { commitment: "confirmed" },
    });

    console.log("Tree delegate updated to the protocol config PDA.");
    console.log(`Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    treeConfig = await fetchTreeConfigState(umi, merkleTree.publicKey.toBase58());
  }

  console.log("\nMerkle tree is ready for RailPay.");
  console.log(`Tree Address:      ${merkleTree.publicKey.toBase58()}`);
  console.log(`Tree Creator:      ${treeConfig?.treeCreator.toString()}`);
  console.log(`Active Delegate:   ${treeConfig?.treeDelegate.toString()}`);
  console.log(`Expected Delegate: ${protocolConfigPda.toBase58()}`);
}

async function fetchTreeConfigState(
  umi: ReturnType<typeof createUmi>,
  merkleTreeAddress: string,
) {
  try {
    return await fetchTreeConfigFromSeeds(umi, { merkleTree: publicKey(merkleTreeAddress) });
  } catch {
    return null;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nTree creation failed: ${message}`);
  process.exit(1);
});
