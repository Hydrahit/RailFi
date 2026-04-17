import "server-only";

import { createHash, randomUUID } from "crypto";
import { getServerRedis } from "@/lib/upstash";
import type {
  OfframpDeadLetterRecord,
  OfframpRecord,
  OfframpStatus,
  ProfileSummary,
  StoredUpiHandle,
} from "@/types/offramp";
import { getComplianceRecord } from "@/lib/compliance/store";

const OFFRAMP_TTL_SECONDS = 90 * 24 * 60 * 60;
const DLQ_TTL_SECONDS = 7 * 24 * 60 * 60;
const PROFILE_TTL_SECONDS = 365 * 24 * 60 * 60;
const MAX_UPI_HANDLES = 3;

function getRedis() {
  return getServerRedis("offramp store");
}

function offrampKey(transferId: string): string {
  return `offramp:${transferId}`;
}

function walletIndexKey(walletAddress: string): string {
  return `offramp:wallet:${walletAddress}`;
}

function dlqKey(transferId: string): string {
  return `offramp:dlq:${transferId}`;
}

function handlesKey(walletAddress: string): string {
  return `profile:upi:${walletAddress}`;
}

function profileFlagsKey(walletAddress: string): string {
  return `profile:flags:${walletAddress}`;
}

function dailyUsageKey(walletAddress: string, dayKey: string): string {
  return `limits:${walletAddress}:daily:${dayKey}`;
}

function monthlyUsageKey(walletAddress: string, monthKey: string): string {
  return `limits:${walletAddress}:monthly:${monthKey}`;
}

export function buildTransferId(signature: string): string {
  return `RAIL_${signature.replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}`;
}

export function maskUpiId(upiId: string): string {
  const normalized = upiId.trim().toLowerCase();
  const [name = "", bank = "upi"] = normalized.split("@");
  if (!name) {
    return `***@${bank}`;
  }
  const prefix = name.slice(0, Math.min(2, name.length));
  return `${prefix}${"*".repeat(Math.max(3, name.length - prefix.length))}@${bank}`;
}

export function hashUpiId(upiId: string): string {
  return createHash("sha256").update(upiId.trim().toLowerCase()).digest("hex");
}

export function inferBankNameFromUpi(upiId: string): string {
  const handle = upiId.trim().toLowerCase().split("@")[1] ?? "upi";
  const map: Record<string, string> = {
    okicici: "ICICI Bank",
    okhdfcbank: "HDFC Bank",
    oksbi: "State Bank of India",
    okaxis: "Axis Bank",
    ybl: "PhonePe",
    paytm: "Paytm Payments Bank",
    apl: "Airtel Payments Bank",
    upi: "UPI",
  };
  return map[handle] ?? handle.toUpperCase();
}

export function mapCashfreeStatusToOfframpStatus(status: string | null | undefined): OfframpStatus {
  const normalized = status?.trim().toUpperCase() ?? "";

  if (
    normalized === "SUCCESS" ||
    normalized === "TRANSFER_SUCCESS" ||
    normalized === "COMPLETED" ||
    normalized === "PAID"
  ) {
    return "SUCCESS";
  }

  if (normalized === "REVERSED" || normalized === "REFUNDED") {
    return "REVERSED";
  }

  if (
    normalized === "FAILED" ||
    normalized === "TRANSFER_FAILED" ||
    normalized === "REJECTED" ||
    normalized === "CANCELLED"
  ) {
    return "FAILED";
  }

  if (
    normalized === "PENDING" ||
    normalized === "PROCESSING" ||
    normalized === "UNDER_REVIEW" ||
    normalized === "IN_PROGRESS"
  ) {
    return "PAYOUT_PENDING";
  }

  return "PAYOUT_PENDING";
}

export async function putOfframpRecord(record: OfframpRecord): Promise<void> {
  const redis = getRedis();
  const createdAtScore = Date.parse(record.createdAt);
  await Promise.all([
    redis.setex(offrampKey(record.transferId), OFFRAMP_TTL_SECONDS, record),
    redis.zadd(walletIndexKey(record.walletAddress), { score: createdAtScore, member: record.transferId }),
    redis.expire(walletIndexKey(record.walletAddress), OFFRAMP_TTL_SECONDS),
    incrementUsageCounters(record.walletAddress, record.amountInr, record.createdAt),
  ]);
}

async function incrementUsageCounters(
  walletAddress: string,
  amountInr: number,
  createdAtIso: string,
): Promise<void> {
  const redis = getRedis();
  const createdAt = new Date(createdAtIso);
  const dayKey = createdAt.toISOString().slice(0, 10);
  const monthKey = createdAt.toISOString().slice(0, 7);
  await Promise.all([
    redis.incrbyfloat(dailyUsageKey(walletAddress, dayKey), amountInr),
    redis.expire(dailyUsageKey(walletAddress, dayKey), PROFILE_TTL_SECONDS),
    redis.incrbyfloat(monthlyUsageKey(walletAddress, monthKey), amountInr),
    redis.expire(monthlyUsageKey(walletAddress, monthKey), PROFILE_TTL_SECONDS),
  ]);
}

export async function getOfframpRecord(transferId: string): Promise<OfframpRecord | null> {
  return (await getRedis().get<OfframpRecord>(offrampKey(transferId))) ?? null;
}

export async function updateOfframpRecord(
  transferId: string,
  updater: (current: OfframpRecord | null) => OfframpRecord | null,
): Promise<OfframpRecord | null> {
  const current = await getOfframpRecord(transferId);
  const next = updater(current);
  if (!next) {
    return null;
  }

  await putOfframpRecord(next);
  return next;
}

export async function writeOfframpDeadLetter(transferId: string, payload: string): Promise<void> {
  const record: OfframpDeadLetterRecord = {
    transferId,
    receivedAt: new Date().toISOString(),
    payload,
  };
  await getRedis().setex(dlqKey(transferId), DLQ_TTL_SECONDS, record);
}

export async function getOfframpDeadLetter(
  transferId: string,
): Promise<OfframpDeadLetterRecord | null> {
  return (await getRedis().get<OfframpDeadLetterRecord>(dlqKey(transferId))) ?? null;
}

export async function listWalletOfframpRecords(walletAddress: string, limit = 25): Promise<OfframpRecord[]> {
  const redis = getRedis();
  const transferIds = await redis.zrange<string[]>(walletIndexKey(walletAddress), 0, limit - 1, {
    rev: true,
  });

  if (!transferIds?.length) {
    return [];
  }

  const records = await Promise.all(transferIds.map((transferId) => getOfframpRecord(transferId)));
  return records.filter((record): record is OfframpRecord => !!record);
}

export async function listStoredUpiHandles(walletAddress: string): Promise<StoredUpiHandle[]> {
  return (await getRedis().get<StoredUpiHandle[]>(handlesKey(walletAddress))) ?? [];
}

export async function addStoredUpiHandle(walletAddress: string, upiId: string): Promise<StoredUpiHandle[]> {
  const existing = await listStoredUpiHandles(walletAddress);
  const upiHash = hashUpiId(upiId);

  if (existing.some((handle) => handle.upiHash === upiHash)) {
    return existing;
  }

  if (existing.length >= MAX_UPI_HANDLES) {
    throw new Error("You can only link up to 3 UPI handles.");
  }

  const nextHandle: StoredUpiHandle = {
    id: randomUUID(),
    upiHash,
    upiMasked: maskUpiId(upiId),
    bankName: inferBankNameFromUpi(upiId),
    isDefault: existing.length === 0,
    addedAt: new Date().toISOString(),
  };

  const next = [...existing, nextHandle];
  await getRedis().setex(handlesKey(walletAddress), PROFILE_TTL_SECONDS, next);
  return next;
}

export async function removeStoredUpiHandle(walletAddress: string, handleId: string): Promise<StoredUpiHandle[]> {
  const existing = await listStoredUpiHandles(walletAddress);
  const filtered = existing.filter((handle) => handle.id !== handleId);
  const next = filtered.map((handle, index) => ({ ...handle, isDefault: index === 0 ? true : handle.isDefault }));
  if (filtered.length > 0 && !filtered.some((handle) => handle.isDefault)) {
    next[0] = { ...next[0], isDefault: true };
  }
  await getRedis().setex(handlesKey(walletAddress), PROFILE_TTL_SECONDS, next);
  return next;
}

export async function setDefaultUpiHandle(walletAddress: string, handleId: string): Promise<StoredUpiHandle[]> {
  const existing = await listStoredUpiHandles(walletAddress);
  const next = existing.map((handle) => ({ ...handle, isDefault: handle.id === handleId }));
  await getRedis().setex(handlesKey(walletAddress), PROFILE_TTL_SECONDS, next);
  return next;
}

export async function getProfileFlags(walletAddress: string): Promise<{ googleLinked: boolean; walletLinked: boolean }> {
  return (
    (await getRedis().get<{ googleLinked: boolean; walletLinked: boolean }>(profileFlagsKey(walletAddress))) ?? {
      googleLinked: false,
      walletLinked: true,
    }
  );
}

export async function setProfileFlags(
  walletAddress: string,
  flags: Partial<{ googleLinked: boolean; walletLinked: boolean }>,
): Promise<void> {
  const current = await getProfileFlags(walletAddress);
  await getRedis().setex(profileFlagsKey(walletAddress), PROFILE_TTL_SECONDS, {
    ...current,
    ...flags,
  });
}

function shortAddress(walletAddress: string): string {
  return `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
}

function deriveTierFromCompliance(
  approvedTier: "NONE" | "LITE" | "FULL",
): { kycTier: 0 | 1 | 2 | 3; kycTierLabel: ProfileSummary["kycTierLabel"]; dailyLimitInr: number; monthlyLimitInr: number } {
  if (approvedTier === "FULL") {
    return { kycTier: 3, kycTierLabel: "Premium", dailyLimitInr: 1_000_000, monthlyLimitInr: 3_000_000 };
  }
  if (approvedTier === "LITE") {
    return { kycTier: 1, kycTierLabel: "Basic", dailyLimitInr: 50_000, monthlyLimitInr: 200_000 };
  }
  return { kycTier: 0, kycTierLabel: "Unverified", dailyLimitInr: 0, monthlyLimitInr: 0 };
}

export async function getProfileSummary(walletAddress: string): Promise<ProfileSummary> {
  const [records, handles, compliance, flags] = await Promise.all([
    listWalletOfframpRecords(walletAddress, 250),
    listStoredUpiHandles(walletAddress),
    getComplianceRecord(walletAddress),
    getProfileFlags(walletAddress),
  ]);

  const memberSince = records.length > 0 ? records[records.length - 1]!.createdAt : null;
  const totalOfframpedInr = records.reduce((sum, record) => sum + record.amountInr, 0);
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const monthKey = now.toISOString().slice(0, 7);
  const redis = getRedis();
  const [usedTodayInrRaw, usedMonthInrRaw] = await Promise.all([
    redis.get<number>(dailyUsageKey(walletAddress, dayKey)),
    redis.get<number>(monthlyUsageKey(walletAddress, monthKey)),
  ]);

  const tier = deriveTierFromCompliance(compliance?.approvedTier ?? "NONE");

  return {
    walletAddress,
    shortAddress: shortAddress(walletAddress),
    avatarSeed: createHash("sha256").update(walletAddress).digest("hex").slice(0, 12),
    memberSince,
    totalOfframpedInr,
    totalOfframpedCount: records.length,
    kycTier: tier.kycTier,
    kycTierLabel: tier.kycTierLabel,
    dailyLimitInr: tier.dailyLimitInr,
    monthlyLimitInr: tier.monthlyLimitInr,
    usedTodayInr: Number(usedTodayInrRaw ?? 0),
    usedMonthInr: Number(usedMonthInrRaw ?? 0),
    kycVerifiedAt: compliance?.issuedAt ? new Date(compliance.issuedAt * 1000).toISOString() : null,
    handles,
    googleLinked: flags.googleLinked,
    walletLinked: flags.walletLinked,
  };
}
