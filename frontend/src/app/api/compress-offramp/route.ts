import { NextRequest, NextResponse } from "next/server";
import {
  LightSystemProgram,
  bn,
  buildAndSignTx,
  createCompressedAccount,
  createRpc,
  defaultStaticAccountsStruct,
  defaultTestStateTreeAccounts,
  hashToBn254FieldSizeBe,
  packCompressedAccounts,
  sendAndConfirmTx,
  toAccountMetas,
} from "@lightprotocol/stateless.js";
import { Keypair, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import { PROGRAM_ID } from "@/lib/solana";
import { getServerLightRpcUrl, getServerSolanaRpcUrl } from "@/lib/server-env";
import { enforceIpRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CompressOfframpBody {
  owner: string;
  usdc_amount: number;
  estimated_inr: number;
  upi_id_partial: string;
  status: 0 | 1 | 2;
  created_at: number;
}

function getServiceKeypair(): Keypair {
  const raw = process.env.COMPRESSION_SERVICE_KEYPAIR;
  if (!raw) {
    throw new Error("COMPRESSION_SERVICE_KEYPAIR not set");
  }
  return Keypair.fromSecretKey(bs58.decode(raw));
}

async function buildCompressedRecordInstruction(
  payer: Keypair,
  payload: Buffer,
) {
  const programId = PROGRAM_ID;
  const outputStateTree = defaultTestStateTreeAccounts().merkleTree;
  const lamports = bn(1);
  const discriminator = Buffer.from("railpay5");
  const hashResult = await hashToBn254FieldSizeBe(
    Buffer.concat([discriminator, payload]),
  );

  if (!hashResult) {
    throw new Error("Failed to derive compressed data hash");
  }

  const [dataHash] = hashResult;
  const outputCompressedAccount = createCompressedAccount(programId, lamports, {
    discriminator: Array.from(discriminator),
    data: payload,
    dataHash: Array.from(dataHash),
  });

  const {
    packedInputCompressedAccounts,
    packedOutputCompressedAccounts,
    remainingAccounts,
  } = packCompressedAccounts([], [], [outputCompressedAccount], outputStateTree);

  const ixData = LightSystemProgram.program.coder.types.encode(
    "InstructionDataInvoke",
    {
      proof: null,
      inputCompressedAccountsWithMerkleContext: packedInputCompressedAccounts,
      outputCompressedAccounts: packedOutputCompressedAccounts,
      relayFee: null,
      newAddressParams: [],
      compressOrDecompressLamports: lamports,
      isCompress: true,
    },
  );

  return LightSystemProgram.program.methods
    .invoke(ixData)
    .accounts({
      ...defaultStaticAccountsStruct(),
      feePayer: payer.publicKey,
      authority: payer.publicKey,
      solPoolPda: LightSystemProgram.deriveCompressedSolPda(),
      decompressionRecipient: null,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(toAccountMetas(remainingAccounts))
    .instruction();
}

function parseCompressOfframpBody(value: unknown): CompressOfframpBody | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const owner =
    typeof (value as { owner?: unknown }).owner === "string"
      ? (value as { owner: string }).owner.trim()
      : "";
  const upiIdPartial =
    typeof (value as { upi_id_partial?: unknown }).upi_id_partial === "string"
      ? (value as { upi_id_partial: string }).upi_id_partial.trim()
      : "";
  const usdcAmount = Number((value as { usdc_amount?: unknown }).usdc_amount);
  const estimatedInr = Number((value as { estimated_inr?: unknown }).estimated_inr);
  const status = Number((value as { status?: unknown }).status);
  const createdAt = Number((value as { created_at?: unknown }).created_at);

  if (
    !owner ||
    owner.length > 64 ||
    upiIdPartial.length > 32 ||
    !Number.isFinite(usdcAmount) ||
    usdcAmount < 0 ||
    !Number.isFinite(estimatedInr) ||
    estimatedInr < 0 ||
    !Number.isInteger(status) ||
    ![0, 1, 2].includes(status) ||
    !Number.isInteger(createdAt) ||
    createdAt <= 0
  ) {
    return null;
  }

  return {
    owner,
    usdc_amount: usdcAmount,
    estimated_inr: estimatedInr,
    upi_id_partial: upiIdPartial,
    status: status as 0 | 1 | 2,
    created_at: createdAt,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ipLimit = await enforceIpRateLimit(
    request,
    "compressOfframpIp",
    "Compression bridge rate limit exceeded for this IP.",
  );
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: ipLimit.message }, { status: 429 });
  }

  const configuredToken = process.env.INTERNAL_API_TOKEN?.trim();
  const authToken = request.headers.get("X-Internal-Token");
  if (!configuredToken) {
    console.error("[compress-offramp] INTERNAL_API_TOKEN is not configured.");
    return NextResponse.json({ error: "Internal authentication is not configured." }, { status: 503 });
  }

  if (authToken !== configuredToken) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: CompressOfframpBody | null = null;
  try {
    body = parseCompressOfframpBody(await request.json());
  } catch {
    body = null;
  }

  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const serviceKeypair = getServiceKeypair();
    const rpc = createRpc(
      getServerSolanaRpcUrl(),
      getServerLightRpcUrl(),
    );

    const dataBytes = Buffer.from(JSON.stringify(body), "utf8");
    const instruction = await buildCompressedRecordInstruction(
      serviceKeypair,
      dataBytes,
    );
    const latestBlockhash = await rpc.getLatestBlockhash();
    const transaction = buildAndSignTx(
      [instruction],
      serviceKeypair,
      latestBlockhash.blockhash,
    );
    const signature = await sendAndConfirmTx(
      rpc,
      transaction,
      undefined,
      latestBlockhash,
    );

    console.log(`[Compress] Compressed offramp for ${body.owner}: ${signature}`);
    return NextResponse.json({ success: true, signature });
  } catch (error) {
    console.error("[Compress] Failed to compress offramp:", error);
    return NextResponse.json(
      { success: false, error: "Failed to compress offramp record." },
      { status: 500 },
    );
  }
}
