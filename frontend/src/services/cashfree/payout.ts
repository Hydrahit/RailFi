import "server-only";

import { createHash, randomUUID } from "crypto";
import { fetchWithTimeout, TIMEOUTS } from "@/lib/fetch-with-timeout";
import { getServerRedis } from "@/lib/upstash";
import {
  getOfframpRecord,
  mapCashfreeStatusToOfframpStatus,
  maskUpiId,
  putOfframpRecord,
  updateOfframpRecord,
  writeOfframpDeadLetter as writeDLQ,
} from "@/lib/offramp-store";
import {
  buildExternalPayoutTransferId,
  completePayoutAttempt,
  createPayoutAttempt,
  failPayoutAttempt,
} from "@/lib/payout-attempts";
import type { OfframpRecord } from "@/types/offramp";

const CASHFREE_TOKEN_CACHE_KEY = "cashfree:auth:token";
const PREPARED_PAYOUT_KEY_PREFIX = "offramp:payout:prepared";
const PAYOUT_KEY_PREFIX = "offramp:payout";
const PAYOUT_WALLET_KEY_PREFIX = "offramp:payout:wallet";
const PREPARED_PAYOUT_TTL_SECONDS = 30 * 60;
const PAYOUT_RECORD_TTL_SECONDS = 60 * 60 * 24 * 365 * 2;
const CASHFREE_TOKEN_TTL_SECONDS = 25 * 60;

export type CashfreePayoutStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED";

export interface PreparedPayoutMetadata {
  walletAddress: string;
  upiId: string;
  amountMicroUsdc: string;
  inrPaise: string;
  referralPubkey: string | null;
  stagedAt: number;
}

export interface CashfreePayoutRecord {
  transferId: string;
  walletAddress: string;
  solanaSignature: string | null;
  upiMasked: string;
  amountMicroUsdc: string;
  inrPaise: string;
  referralPubkey: string | null;
  amountInr: string;
  status: CashfreePayoutStatus;
  cashfreeTransferId: string | null;
  utr: string | null;
  createdAt: number;
  updatedAt: number;
}

interface CashfreeAuthorizeResponse {
  data?: {
    token?: string;
  };
  message?: string;
}

interface CashfreeBeneficiaryResponse {
  status?: string;
  message?: string;
  subCode?: string;
}

interface CashfreeTransferResponse {
  status?: string;
  message?: string;
  subCode?: string;
  data?: {
    referenceId?: string;
    transferId?: string;
    status?: string;
    utr?: string;
  };
}

interface CashfreeTransferStatusResponse {
  status?: string;
  message?: string;
  subCode?: string;
  data?: {
    transferId?: string;
    status?: string;
    utr?: string;
  };
}

interface InitiateUpiPayoutParams {
  transferId: string;
  walletAddress: string;
  solanaSignature: string;
  upiId: string;
  amountMicroUsdc: string;
  inrPaise: string;
  referralPubkey: string | null;
  externalTransferId?: string;
  attemptKind?: "cashfree-init" | "cashfree-retry";
}

function getRedis() {
  return getServerRedis("cashfree payouts");
}

function getCashfreeBaseUrl(): string {
  return process.env.CASHFREE_ENV?.trim().toLowerCase() === "production"
    ? "https://payout-api.cashfree.com"
    : "https://payout-gamma.cashfree.com";
}

function getCashfreeCredentials() {
  const clientId = process.env.CASHFREE_CLIENT_ID?.trim();
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("Cashfree credentials are not configured.");
  }

  return { clientId, clientSecret };
}

function payoutRecordKey(transferId: string): string {
  return `${PAYOUT_KEY_PREFIX}:${transferId}`;
}

function payoutWalletKey(walletAddress: string): string {
  return `${PAYOUT_WALLET_KEY_PREFIX}:${walletAddress}`;
}

function preparedPayoutKey(serializedTransaction: string): string {
  const digest = createHash("sha256").update(serializedTransaction).digest("hex");
  return `${PREPARED_PAYOUT_KEY_PREFIX}:${digest}`;
}

function normalizeCashfreeStatus(value: string | null | undefined): CashfreePayoutStatus {
  const normalized = value?.trim().toUpperCase() ?? "";

  if (
    normalized === "SUCCESS" ||
    normalized === "COMPLETED" ||
    normalized === "PAID" ||
    normalized === "TRANSFER_SUCCESS"
  ) {
    return "SUCCESS";
  }

  if (
    normalized === "FAILED" ||
    normalized === "REJECTED" ||
    normalized === "CANCELLED" ||
    normalized === "TRANSFER_FAILED"
  ) {
    return "FAILED";
  }

  if (
    normalized === "PROCESSING" ||
    normalized === "IN_PROGRESS" ||
    normalized === "UNDER_REVIEW"
  ) {
    return "PROCESSING";
  }

  return "PENDING";
}

function paiseToInrString(inrPaise: string): string {
  const paise = Number(inrPaise);
  if (!Number.isFinite(paise) || paise <= 0) {
    throw new Error("Cashfree payout amount must be greater than zero.");
  }

  return (paise / 100).toFixed(2);
}

async function persistPayoutRecord(record: CashfreePayoutRecord): Promise<void> {
  const redis = getRedis();
  await Promise.all([
    redis.setex(payoutRecordKey(record.transferId), PAYOUT_RECORD_TTL_SECONDS, record),
    redis.zadd(payoutWalletKey(record.walletAddress), {
      score: record.updatedAt,
      member: record.transferId,
    }),
    redis.expire(payoutWalletKey(record.walletAddress), PAYOUT_RECORD_TTL_SECONDS),
  ]);
}

async function readPayoutRecord(transferId: string): Promise<CashfreePayoutRecord | null> {
  return (await getRedis().get<CashfreePayoutRecord>(payoutRecordKey(transferId))) ?? null;
}

export async function getStoredPayoutRecord(transferId: string): Promise<CashfreePayoutRecord | null> {
  return readPayoutRecord(transferId);
}

async function updatePayoutRecord(
  transferId: string,
  updater: (current: CashfreePayoutRecord | null) => CashfreePayoutRecord | null,
): Promise<CashfreePayoutRecord | null> {
  const current = await readPayoutRecord(transferId);
  const next = updater(current);
  if (!next) {
    return null;
  }

  await persistPayoutRecord(next);
  return next;
}

function mapOfframpRecordToPayoutRecord(record: OfframpRecord): CashfreePayoutRecord {
  return {
    transferId: record.transferId,
    walletAddress: record.walletAddress,
    solanaSignature: record.solanaTx,
    upiMasked: record.upiMasked,
    amountMicroUsdc: record.amountMicroUsdc,
    inrPaise: String(record.amountInrPaise),
    referralPubkey: record.referralPubkey,
    amountInr: record.amountInr.toFixed(2),
    status:
      record.status === "SUCCESS"
        ? "SUCCESS"
        : record.status === "FAILED" || record.status === "REVERSED" || record.status === "REQUIRES_REVIEW"
          ? "FAILED"
          : "PENDING",
    cashfreeTransferId: record.cashfreeId,
    utr: record.utr,
    createdAt: Math.floor(Date.parse(record.createdAt) / 1000),
    updatedAt: Math.floor(Date.parse(record.completedAt ?? record.createdAt) / 1000),
  };
}

async function addBeneficiary(args: {
  transferId: string;
  token: string;
  upiId: string;
}): Promise<void> {
  const response = await fetchWithTimeout(`${getCashfreeBaseUrl()}/payout/v1/addBeneficiary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.token}`,
    },
    body: JSON.stringify({
      beneId: args.transferId,
      name: "RailFi User",
      email: "payouts@railpay.app",
      phone: "9999999999",
      vpa: args.upiId,
      address1: "RailFi",
    }),
    cache: "no-store",
    timeoutMs: TIMEOUTS.cashfree,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as CashfreeBeneficiaryResponse;
    throw new Error(
      payload.message ?? `Cashfree beneficiary creation failed with status ${response.status}.`,
    );
  }
}

export async function getCashfreeToken(): Promise<string> {
  const redis = getRedis();
  const cached = await redis.get<string>(CASHFREE_TOKEN_CACHE_KEY);
  if (cached) {
    return cached;
  }

  const { clientId, clientSecret } = getCashfreeCredentials();
  const response = await fetchWithTimeout(`${getCashfreeBaseUrl()}/payout/v1/authorize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": clientId,
      "X-Client-Secret": clientSecret,
    },
    cache: "no-store",
    timeoutMs: TIMEOUTS.cashfree,
  });

  const payload = (await response.json().catch(() => ({}))) as CashfreeAuthorizeResponse;
  const token = payload.data?.token?.trim();
  if (!response.ok || !token) {
    throw new Error(
      payload.message ?? `Cashfree authorization failed with status ${response.status}.`,
    );
  }

  await redis.setex(CASHFREE_TOKEN_CACHE_KEY, CASHFREE_TOKEN_TTL_SECONDS, token);
  return token;
}

export async function stagePreparedPayout(
  serializedTransaction: string,
  metadata: Omit<PreparedPayoutMetadata, "stagedAt">,
): Promise<void> {
  await getRedis().setex(preparedPayoutKey(serializedTransaction), PREPARED_PAYOUT_TTL_SECONDS, {
    ...metadata,
    stagedAt: Math.floor(Date.now() / 1000),
  } satisfies PreparedPayoutMetadata);
}

export async function consumePreparedPayout(
  serializedTransaction: string,
): Promise<PreparedPayoutMetadata | null> {
  const redis = getRedis();
  const key = preparedPayoutKey(serializedTransaction);
  const prepared = await redis.get<PreparedPayoutMetadata>(key);
  if (!prepared) {
    return null;
  }

  await redis.del(key);
  return prepared;
}

export function createPayoutTransferId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 32);
}

export async function recordPayoutQueued(args: {
  transferId: string;
  walletAddress: string;
  solanaSignature: string | null;
  prepared: PreparedPayoutMetadata;
}): Promise<CashfreePayoutRecord> {
  const now = Math.floor(Date.now() / 1000);
  const record: CashfreePayoutRecord = {
    transferId: args.transferId,
    walletAddress: args.walletAddress,
    solanaSignature: args.solanaSignature,
    upiMasked: maskUpiId(args.prepared.upiId),
    amountMicroUsdc: args.prepared.amountMicroUsdc,
    inrPaise: args.prepared.inrPaise,
    referralPubkey: args.prepared.referralPubkey,
    amountInr: paiseToInrString(args.prepared.inrPaise),
    status: "PENDING",
    cashfreeTransferId: args.transferId,
    utr: null,
    createdAt: now,
    updatedAt: now,
  };

  await persistPayoutRecord(record);
  if (args.solanaSignature) {
    await putOfframpRecord({
      transferId: args.transferId,
      solanaTx: args.solanaSignature,
      cashfreeId: args.transferId,
      walletAddress: args.walletAddress,
      amountUsdc: Number(args.prepared.amountMicroUsdc) / 1_000_000,
      amountMicroUsdc: args.prepared.amountMicroUsdc,
      amountInr: Number(paiseToInrString(args.prepared.inrPaise)),
      amountInrPaise: Number(args.prepared.inrPaise),
      upiMasked: maskUpiId(args.prepared.upiId),
      upiHash: null,
      status: "PAYOUT_PENDING",
      utr: null,
      createdAt: new Date(now * 1000).toISOString(),
      completedAt: null,
        requiresReview: false,
        failureReason: null,
        retryCount: 0,
        lastRetryAt: null,
        referralPubkey: args.prepared.referralPubkey,
      });
  }
  return record;
}

export async function initiateUpiPayout(
  params: InitiateUpiPayoutParams,
): Promise<{ cashfreeTransferId: string | null; status: CashfreePayoutStatus; utr: string | null }> {
  const externalTransferId =
    params.externalTransferId?.trim() || buildExternalPayoutTransferId(params.transferId, 0);

  try {
    await createPayoutAttempt({
      transferId: params.transferId,
      externalTransferId,
      kind: params.attemptKind ?? "cashfree-init",
    });

    const token = await getCashfreeToken();
    await addBeneficiary({
      transferId: externalTransferId,
      token,
      upiId: params.upiId,
    });

    const amountInr = paiseToInrString(params.inrPaise);
    const response = await fetchWithTimeout(`${getCashfreeBaseUrl()}/payout/v1/transfer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        beneId: externalTransferId,
        transferId: externalTransferId,
        amount: Number(amountInr),
        transferMode: "upi",
        remarks: `RailFi payout for ${params.solanaSignature}`,
      }),
      cache: "no-store",
      timeoutMs: TIMEOUTS.cashfree,
    });

    const payload = (await response.json().catch(() => ({}))) as CashfreeTransferResponse;
    const nextStatus = normalizeCashfreeStatus(payload.data?.status ?? payload.status);
    const cashfreeTransferId = payload.data?.transferId?.trim() || externalTransferId;
    const utr = payload.data?.utr?.trim() || null;

    await updatePayoutRecord(params.transferId, (current) => {
      if (!current) {
        return null;
      }

      return {
        ...current,
        status: response.ok ? nextStatus : "FAILED",
        cashfreeTransferId,
        utr,
        updatedAt: Math.floor(Date.now() / 1000),
      };
    });
    await updateOfframpRecord(params.transferId, (current) => {
      if (!current) {
        return null;
      }

      return {
        ...current,
        status: response.ok ? mapCashfreeStatusToOfframpStatus(payload.data?.status ?? payload.status) : "FAILED",
        cashfreeId: cashfreeTransferId,
        utr,
        retryCount: (current.retryCount ?? 0) + (params.attemptKind === "cashfree-retry" ? 1 : 0),
        lastRetryAt:
          params.attemptKind === "cashfree-retry" ? new Date().toISOString() : current.lastRetryAt ?? null,
        failureReason: response.ok ? null : payload.message ?? "Cashfree transfer failed.",
        completedAt:
          nextStatus === "SUCCESS" || nextStatus === "FAILED"
            ? new Date().toISOString()
            : current.completedAt,
        requiresReview: !response.ok,
      };
    });

    if (!response.ok) {
      await failPayoutAttempt(
        externalTransferId,
        payload.message ?? `Cashfree transfer failed with status ${response.status}.`,
      );
      throw new Error(
        payload.message ?? `Cashfree transfer failed with status ${response.status}.`,
      );
    }

    await completePayoutAttempt(externalTransferId);

    return { cashfreeTransferId, status: nextStatus, utr };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cashfree transfer failed.";
    await failPayoutAttempt(externalTransferId, message);
    await updatePayoutRecord(params.transferId, (current) => {
      if (!current) {
        return null;
      }

      return {
        ...current,
        status: "FAILED",
        cashfreeTransferId: current.cashfreeTransferId ?? externalTransferId,
        updatedAt: Math.floor(Date.now() / 1000),
      };
    });
    await updateOfframpRecord(params.transferId, (current) => {
      if (!current) {
        return null;
      }

      return {
        ...current,
        status: "FAILED",
        completedAt: new Date().toISOString(),
        requiresReview: true,
        failureReason: message,
        retryCount: (current.retryCount ?? 0) + (params.attemptKind === "cashfree-retry" ? 1 : 0),
        lastRetryAt:
          params.attemptKind === "cashfree-retry" ? new Date().toISOString() : current.lastRetryAt ?? null,
      };
    });
    throw error;
  }
}

export async function getPayoutStatus(transferId: string): Promise<CashfreePayoutRecord | null> {
  const canonical = await getOfframpRecord(transferId);
  const existing = (await readPayoutRecord(transferId)) ?? (canonical ? mapOfframpRecordToPayoutRecord(canonical) : null);
  if (!existing) {
    return null;
  }

  const externalTransferId = canonical?.cashfreeId ?? existing.cashfreeTransferId ?? transferId;

  try {
    const token = await getCashfreeToken();
    const response = await fetchWithTimeout(
      `${getCashfreeBaseUrl()}/payout/v1/transfer/status?transferId=${encodeURIComponent(externalTransferId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        timeoutMs: TIMEOUTS.cashfree,
      },
    );

    if (!response.ok) {
      return existing;
    }

    const payload = (await response.json().catch(() => ({}))) as CashfreeTransferStatusResponse;
    const next = await updatePayoutRecord(transferId, (current) => {
      if (!current) {
        return null;
      }

      return {
        ...current,
        status: normalizeCashfreeStatus(payload.data?.status ?? payload.status),
        cashfreeTransferId:
          payload.data?.transferId?.trim() || current.cashfreeTransferId || externalTransferId,
        utr: payload.data?.utr?.trim() || current.utr,
        updatedAt: Math.floor(Date.now() / 1000),
      };
    });
    await updateOfframpRecord(transferId, (current) => {
      if (!current || !next) {
        return current;
      }

      const mappedStatus = mapCashfreeStatusToOfframpStatus(next.status);
      return {
        ...current,
        status:
          mappedStatus === "FAILED" || mappedStatus === "REVERSED"
            ? "REQUIRES_REVIEW"
            : mappedStatus,
        cashfreeId: next.cashfreeTransferId ?? current.cashfreeId,
        utr: next.utr ?? current.utr,
        completedAt:
          mappedStatus === "SUCCESS" || mappedStatus === "FAILED" || mappedStatus === "REVERSED"
            ? new Date().toISOString()
            : current.completedAt,
        requiresReview: mappedStatus === "FAILED" || mappedStatus === "REVERSED",
        failureReason:
          mappedStatus === "FAILED" || mappedStatus === "REVERSED"
            ? `Cashfree payout status resolved to ${next.status}.`
            : null,
      };
    });
    return next;
  } catch {
    return existing;
  }
}

export async function updatePayoutRecordFromWebhook(args: {
  transferId: string;
  status: string | null | undefined;
  utr: string | null | undefined;
}): Promise<CashfreePayoutRecord | null> {
  const existing = await readPayoutRecord(args.transferId);
  if (!existing) {
    const payload = args;
    console.error(
      "[cashfree-payout] Orphaned webhook — no matching record for transferId:",
      args.transferId,
    );
    await writeDLQ(
      args.transferId,
      JSON.stringify(payload),
      "cashfree",
      "no_matching_payout_record",
    );
    return null;
  }

  const payoutRecord = await updatePayoutRecord(args.transferId, (current) => {
    const now = Math.floor(Date.now() / 1000);
    return {
      ...current!,
      status: normalizeCashfreeStatus(args.status),
      utr: args.utr ?? current!.utr,
      cashfreeTransferId: current!.cashfreeTransferId ?? args.transferId,
      updatedAt: now,
    };
  });
  await updateOfframpRecord(args.transferId, (current) => {
    if (!current) {
      return null;
    }

    const mappedStatus = mapCashfreeStatusToOfframpStatus(args.status);
    return {
      ...current,
      status:
        mappedStatus === "FAILED" || mappedStatus === "REVERSED"
          ? "REQUIRES_REVIEW"
          : mappedStatus,
      utr: args.utr ?? current.utr,
      completedAt:
        mappedStatus === "SUCCESS" || mappedStatus === "FAILED" || mappedStatus === "REVERSED"
          ? new Date().toISOString()
          : current.completedAt,
      requiresReview: mappedStatus === "FAILED" || mappedStatus === "REVERSED",
    };
  });
  return payoutRecord;
}
