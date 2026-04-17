import "server-only";

import { createHash } from "crypto";
import {
  bn,
  buildAndSignTx,
  createCompressedAccount,
  createRpc,
  defaultStaticAccountsStruct,
  defaultTestStateTreeAccounts,
  hashToBn254FieldSizeBe,
  LightSystemProgram,
  packCompressedAccounts,
  sendAndConfirmTx,
  toAccountMetas,
  createBN254,
} from "@lightprotocol/stateless.js";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import type { ComplianceTier } from "@/lib/compliance/types";
import {
  assertNoForbiddenPublicSecrets,
  getServerLightRpcUrl,
  getServerSolanaRpcUrl,
} from "@/lib/server-env";

assertNoForbiddenPublicSecrets();

export interface IssuedComplianceAttestation {
  compressedAccountId: string;
  leafIndex: number | null;
  signature: string;
  issuedAt: number;
  expiresAt: number;
}

function getCompressionSigner(): Keypair {
  const raw = process.env.COMPRESSION_SERVICE_KEYPAIR ?? process.env.RELAYER_PRIVATE_KEY;
  if (!raw) {
    throw new Error("COMPRESSION_SERVICE_KEYPAIR or RELAYER_PRIVATE_KEY must be configured.");
  }
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function getLightRpc() {
  const solanaRpcUrl = getServerSolanaRpcUrl();
  const lightRpcUrl = getServerLightRpcUrl();
  return createRpc(solanaRpcUrl, lightRpcUrl);
}

async function buildComplianceInstruction(
  signer: Keypair,
  owner: PublicKey,
  payload: Buffer,
) {
  const lamports = bn(1);
  const discriminator = Buffer.from("rpkyc001");
  const hashResult = await hashToBn254FieldSizeBe(Buffer.concat([discriminator, payload]));
  if (!hashResult) {
    throw new Error("Failed to derive compliance data hash.");
  }

  const [dataHash] = hashResult;
  const outputCompressedAccount = createCompressedAccount(owner, lamports, {
    discriminator: Array.from(discriminator),
    data: payload,
    dataHash: Array.from(dataHash),
  });

  const outputStateTree = defaultTestStateTreeAccounts().merkleTree;
  const {
    packedInputCompressedAccounts,
    packedOutputCompressedAccounts,
    remainingAccounts,
  } = packCompressedAccounts([], [], [outputCompressedAccount], outputStateTree);

  const ixData = LightSystemProgram.program.coder.types.encode("InstructionDataInvoke", {
    proof: null,
    inputCompressedAccountsWithMerkleContext: packedInputCompressedAccounts,
    outputCompressedAccounts: packedOutputCompressedAccounts,
    relayFee: null,
    newAddressParams: [],
    compressOrDecompressLamports: lamports,
    isCompress: true,
  });

  return LightSystemProgram.program.methods
    .invoke(ixData)
    .accounts({
      ...defaultStaticAccountsStruct(),
      feePayer: signer.publicKey,
      authority: signer.publicKey,
      solPoolPda: LightSystemProgram.deriveCompressedSolPda(),
      decompressionRecipient: null,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(toAccountMetas(remainingAccounts))
    .instruction();
}

export async function issueComplianceAttestation(args: {
  walletAddress: string;
  approvedTier: ComplianceTier;
  applicantId: string;
}): Promise<IssuedComplianceAttestation> {
  const signer = getCompressionSigner();
  const rpc = getLightRpc();
  const owner = new PublicKey(args.walletAddress);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + Number(process.env.KYC_ATTESTATION_TTL_SECONDS ?? "31536000");
  const applicantRef = createHash("sha256").update(args.applicantId).digest("hex");
  const payload = Buffer.from(
    JSON.stringify({
      wallet: args.walletAddress,
      approved_tier: args.approvedTier,
      issued_at: issuedAt,
      expires_at: expiresAt,
      applicant_ref: applicantRef,
      version: 1,
    }),
    "utf8",
  );

  const instruction = await buildComplianceInstruction(signer, owner, payload);
  const latestBlockhash = await rpc.getLatestBlockhash();
  const transaction = buildAndSignTx([instruction], signer, latestBlockhash.blockhash);
  const signature = await sendAndConfirmTx(rpc, transaction, undefined, latestBlockhash);

  const accounts = await rpc.getCompressedAccountsByOwner(owner);
  const latestAccount = accounts.items[0];
  if (!latestAccount?.hash) {
    throw new Error("Compliance attestation was sent but no compressed account hash was returned.");
  }

  return {
    compressedAccountId: Buffer.from(latestAccount.hash).toString("hex"),
    leafIndex: latestAccount.leafIndex ?? null,
    signature,
    issuedAt,
    expiresAt,
  };
}

export async function isValidityProofReady(compressedAccountId: string): Promise<boolean> {
  const rpc = getLightRpc();
  try {
    await rpc.getValidityProof([createBN254(compressedAccountId, "hex")], []);
    return true;
  } catch {
    return false;
  }
}
