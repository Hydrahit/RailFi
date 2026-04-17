import "server-only";

import { randomUUID } from "crypto";
import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";
import { explorerAddr } from "@/lib/solana";
import { getServerRedis } from "@/lib/upstash";

const DEMO_RECORD_TTL_SECONDS = 60 * 60 * 24;
const DEMO_KEY_PREFIX = "demo:offramp";

export type DemoFlowState =
  | "idle"
  | "offramp_pending"
  | "offramp_confirmed"
  | "payout_pending"
  | "payout_confirmed"
  | "csv_ready"
  | "error";

export interface DemoOfframpRecord {
  transferId: string;
  walletAddress: string;
  upiId: string;
  amountMicroUsdc: string;
  amountInr: string;
  explorerUrl: string;
  state: DemoFlowState;
  createdAt: number;
  updatedAt: number;
  utr: string | null;
  csvReady: boolean;
}

function getRedis() {
  return getServerRedis("demo flow");
}

function getDemoKey(transferId: string): string {
  return `${DEMO_KEY_PREFIX}:${transferId}`;
}

function getDemoWalletAddress(): string {
  const secret = process.env.DEMO_WALLET_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("DEMO_WALLET_SECRET_KEY is not configured.");
  }

  const keypair = Keypair.fromSecretKey(bs58.decode(secret));
  return keypair.publicKey.toBase58();
}

export function createDemoTransferId(): string {
  return `demo_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export async function createDemoOfframpRecord(args: {
  transferId: string;
  upiId: string;
  amountMicroUsdc: string;
  amountInr: string;
}): Promise<DemoOfframpRecord> {
  const now = Date.now();
  const walletAddress = getDemoWalletAddress();
  const record: DemoOfframpRecord = {
    transferId: args.transferId,
    walletAddress,
    upiId: args.upiId,
    amountMicroUsdc: args.amountMicroUsdc,
    amountInr: args.amountInr,
    explorerUrl: explorerAddr(walletAddress),
    state: "offramp_pending",
    createdAt: now,
    updatedAt: now,
    utr: null,
    csvReady: false,
  };

  await getRedis().setex(getDemoKey(args.transferId), DEMO_RECORD_TTL_SECONDS, record);
  return record;
}

function deriveState(record: DemoOfframpRecord): DemoOfframpRecord {
  const elapsedMs = Date.now() - record.createdAt;
  let nextState: DemoFlowState = "offramp_pending";
  let utr = record.utr;

  if (record.csvReady) {
    nextState = "csv_ready";
  } else if (elapsedMs >= 7_000) {
    nextState = "payout_confirmed";
    utr = utr ?? `UTR${record.transferId.replace(/[^a-z0-9]/gi, "").slice(0, 10).toUpperCase()}`;
  } else if (elapsedMs >= 4_000) {
    nextState = "payout_pending";
  } else if (elapsedMs >= 2_000) {
    nextState = "offramp_confirmed";
  }

  return {
    ...record,
    state: nextState,
    utr,
    updatedAt: Date.now(),
  };
}

export async function getDemoOfframpRecord(transferId: string): Promise<DemoOfframpRecord | null> {
  const redis = getRedis();
  const record = await redis.get<DemoOfframpRecord>(getDemoKey(transferId));
  if (!record) {
    return null;
  }

  const next = deriveState(record);
  await redis.setex(getDemoKey(transferId), DEMO_RECORD_TTL_SECONDS, next);
  return next;
}

export async function markDemoCsvReady(transferId: string): Promise<DemoOfframpRecord | null> {
  const record = await getDemoOfframpRecord(transferId);
  if (!record) {
    return null;
  }

  const next: DemoOfframpRecord = {
    ...record,
    state: "csv_ready",
    csvReady: true,
    updatedAt: Date.now(),
  };
  await getRedis().setex(getDemoKey(transferId), DEMO_RECORD_TTL_SECONDS, next);
  return next;
}
