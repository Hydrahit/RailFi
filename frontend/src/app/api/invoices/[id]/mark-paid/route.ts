import { BorshInstructionCoder, type Idl } from "@coral-xyz/anchor";
import { NextRequest, NextResponse } from "next/server";
import type {
  ParsedInstruction,
  ParsedMessageAccount,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
} from "@solana/web3.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import rawIdl from "@/idl/railpay.json";
import { getInvoice, markInvoicePaid } from "@/lib/invoice-store";
import { CONFIGURED_USDC_MINT, PROGRAM_ID, deriveVaultPda } from "@/lib/solana";
import { equalByteArrays, hashUpiId } from "@/lib/upi";
import {
  attachWalletSessionCookie,
  getRefreshedWalletSessionFromRequest,
} from "@/lib/wallet-session-server";
import { enforceIpRateLimit, enforceWalletRateLimit } from "@/lib/rate-limit";
import { requireTrustedOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idl = rawIdl as Idl;
const coder = new BorshInstructionCoder(idl);
const SIGNATURE_MIN_LENGTH = 44;
const SIGNATURE_MAX_LENGTH = 90;

let connectionSingleton: Connection | null = null;

interface MarkPaidBody {
  offrampTxSig?: string;
}

function validateWallet(wallet: string): boolean {
  try {
    new PublicKey(wallet);
    return true;
  } catch {
    return false;
  }
}

function getConnection(): Connection {
  if (connectionSingleton) {
    return connectionSingleton;
  }

  const rpcUrl = process.env.HELIUS_RPC_URL?.trim();
  if (!rpcUrl) {
    throw new Error("HELIUS_RPC_URL is not configured.");
  }

  connectionSingleton = new Connection(rpcUrl, "confirmed");
  return connectionSingleton;
}

function toBase58AccountKey(account: ParsedMessageAccount | string): string {
  if (typeof account === "string") {
    return account;
  }

  if (typeof account.pubkey === "string") {
    return account.pubkey;
  }

  return account.pubkey.toBase58();
}

function isSignerAccount(account: ParsedMessageAccount | string): boolean {
  return typeof account !== "string" && account.signer;
}

function isPartiallyDecodedInstruction(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
): instruction is PartiallyDecodedInstruction {
  return "data" in instruction && "accounts" in instruction;
}

function extractTriggerInstruction(
  transaction: ParsedTransactionWithMeta,
): PartiallyDecodedInstruction | null {
  for (const instruction of transaction.transaction.message.instructions) {
    if (!isPartiallyDecodedInstruction(instruction)) {
      continue;
    }

    if (!instruction.programId.equals(PROGRAM_ID)) {
      continue;
    }

    const decoded = coder.decode(instruction.data, "base58");
    if (decoded?.name === "triggerOfframp") {
      return instruction;
    }
  }

  return null;
}

function extractDecodedAmount(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("usdcAmount" in data)) {
    return null;
  }

  const value = (data as { usdcAmount?: { toString(): string } | number | string }).usdcAmount;
  if (value === undefined || value === null) {
    return null;
  }

  return value.toString();
}

function extractDecodedDestinationUpiHash(data: unknown): Uint8Array | null {
  if (!data || typeof data !== "object" || !("destinationUpiHash" in data)) {
    return null;
  }

  const value = (data as { destinationUpiHash?: unknown }).destinationUpiHash;
  if (value instanceof Uint8Array) {
    return value.length === 32 ? value : null;
  }

  if (!Array.isArray(value) || value.length !== 32) {
    return null;
  }

  if (!value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    return null;
  }

  return Uint8Array.from(value);
}

function validatePositiveUsdcDeltas(
  transaction: ParsedTransactionWithMeta,
  expectedVaultAta: string,
): boolean {
  const preTokenBalances = transaction.meta?.preTokenBalances ?? [];
  const postTokenBalances = transaction.meta?.postTokenBalances ?? [];
  const accountKeys = transaction.transaction.message.accountKeys.map(toBase58AccountKey);
  const configuredMint = CONFIGURED_USDC_MINT.toBase58();

  for (const postBalance of postTokenBalances) {
    if (postBalance.mint !== configuredMint) {
      continue;
    }

    const preBalance = preTokenBalances.find(
      (candidate) =>
        candidate.accountIndex === postBalance.accountIndex && candidate.mint === postBalance.mint,
    );

    const postAmount = BigInt(postBalance.uiTokenAmount.amount);
    const preAmount = BigInt(preBalance?.uiTokenAmount.amount ?? "0");
    if (postAmount <= preAmount) {
      continue;
    }

    const positiveDeltaAccount = accountKeys[postBalance.accountIndex];
    if (positiveDeltaAccount !== expectedVaultAta) {
      return false;
    }
  }

  return true;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const originViolation = requireTrustedOrigin(request);
  if (originViolation) {
    return originViolation;
  }

  try {
    const session = await getRefreshedWalletSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ipLimit = await enforceIpRateLimit(
      request,
      "invoiceMarkPaidIp",
      "Too many invoice payment-finalization requests. Please try again later.",
    );
    if (!ipLimit.allowed) {
      return NextResponse.json({ error: ipLimit.message }, { status: 429 });
    }

    const walletLimit = await enforceWalletRateLimit(
      session.walletAddress,
      "invoiceMarkPaidWallet",
      "Invoice payment-finalization rate limit exceeded for this wallet.",
    );
    if (!walletLimit.allowed) {
      return NextResponse.json({ error: walletLimit.message }, { status: 429 });
    }

    const body = (await request.json()) as MarkPaidBody;
    const paidByWallet = session.walletAddress;
    const offrampTxSig = body.offrampTxSig?.trim() ?? "";

    if (!validateWallet(paidByWallet) || !offrampTxSig) {
      return NextResponse.json(
        { error: "offrampTxSig is required." },
        { status: 400 },
      );
    }

    if (
      typeof offrampTxSig !== "string" ||
      offrampTxSig.length < SIGNATURE_MIN_LENGTH ||
      offrampTxSig.length > SIGNATURE_MAX_LENGTH
    ) {
      return NextResponse.json(
        { error: "Invalid transaction signature format." },
        { status: 400 },
      );
    }

    const invoice = await getInvoice(params.id);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    if (invoice.status === "EXPIRED") {
      return NextResponse.json({ error: "Invoice expired." }, { status: 409 });
    }

    if (invoice.status === "PAID") {
      return NextResponse.json(
        { error: "Invoice already paid.", invoice },
        { status: 409 },
      );
    }

    const connection = getConnection();
    let transaction: ParsedTransactionWithMeta | null;

    try {
      transaction = await connection.getParsedTransaction(offrampTxSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch (error) {
      console.error("[mark-paid] Failed to load transaction:", error);
      return NextResponse.json(
        { error: "Could not verify transaction on-chain." },
        { status: 502 },
      );
    }

    if (!transaction) {
      return NextResponse.json(
        { error: "Transaction not found on-chain." },
        { status: 400 },
      );
    }

    if (transaction.meta?.err != null) {
      return NextResponse.json(
        { error: "Transaction failed on-chain and cannot mark this invoice as paid." },
        { status: 400 },
      );
    }

    const messageAccountKeys = transaction.transaction.message.accountKeys;
    const signerKeys = messageAccountKeys
      .filter(isSignerAccount)
      .map(toBase58AccountKey);

    if (!signerKeys.includes(paidByWallet)) {
      return NextResponse.json(
        { error: "paidByWallet did not sign the claimed transaction." },
        { status: 400 },
      );
    }

    const expectedUser = new PublicKey(paidByWallet);
    const [expectedVault] = deriveVaultPda(expectedUser);
    const expectedVaultAta = getAssociatedTokenAddressSync(
      CONFIGURED_USDC_MINT,
      expectedVault,
      true,
    );

    const triggerInstruction = extractTriggerInstruction(transaction);
    if (!triggerInstruction) {
      return NextResponse.json(
        { error: "Transaction does not contain a canonical RailFi settlement request." },
        { status: 400 },
      );
    }

    const decodedInstruction = coder.decode(triggerInstruction.data, "base58");
    if (!decodedInstruction || decodedInstruction.name !== "triggerOfframp") {
      return NextResponse.json(
        { error: "Unable to decode the RailFi settlement instruction." },
        { status: 400 },
      );
    }

    const instructionAccounts = triggerInstruction.accounts.map((account) =>
      account.toBase58(),
    );
    if (
      instructionAccounts[2] !== paidByWallet ||
      instructionAccounts[6] !== expectedVault.toBase58() ||
      instructionAccounts[8] !== expectedVaultAta.toBase58()
    ) {
      return NextResponse.json(
        { error: "Transaction does not use the expected RailFi vault accounts." },
        { status: 400 },
      );
    }

    const expectedAmountMicroUsdc = Math.round(invoice.amount * 1_000_000).toString();
    const decodedAmount = extractDecodedAmount(decodedInstruction.data);
    if (decodedAmount !== expectedAmountMicroUsdc) {
      return NextResponse.json(
        { error: "Transaction amount does not match this invoice." },
        { status: 400 },
      );
    }

    const decodedDestinationUpiHash = extractDecodedDestinationUpiHash(decodedInstruction.data);
    const expectedDestinationUpiHash = await hashUpiId(invoice.destinationUpiId);
    if (
      !decodedDestinationUpiHash ||
      !equalByteArrays(decodedDestinationUpiHash, expectedDestinationUpiHash)
    ) {
      return NextResponse.json(
        { error: "Transaction destination does not match this invoice." },
        { status: 400 },
      );
    }

    // The current trigger_offramp flow does not generally create a positive USDC delta,
    // but if one appears in the transaction it must belong to the canonical payer vault ATA.
    if (!validatePositiveUsdcDeltas(transaction, expectedVaultAta.toBase58())) {
      return NextResponse.json(
        { error: "Transaction contains a USDC balance increase on a non-canonical account." },
        { status: 400 },
      );
    }

    const updated = await markInvoicePaid(params.id, { paidByWallet, offrampTxSig });
    if (!updated || updated.status !== "PAID") {
      return NextResponse.json(
        { error: "Invoice could not be marked paid." },
        { status: 409 },
      );
    }

    const response = NextResponse.json(updated, { status: 200 });
    return attachWalletSessionCookie(response, session.sessionId);
  } catch (error) {
    console.error("[mark-paid] failed:", error);
    return NextResponse.json({ error: "Failed to update invoice." }, { status: 500 });
  }
}
