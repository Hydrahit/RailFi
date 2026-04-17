import "server-only";

import type {
  CreateInvoiceInput,
  InvoiceRecord,
  InvoiceStatus,
  MarkInvoicePaidInput,
} from "@/types/invoice";
import { getServerRedis } from "@/lib/upstash";

const ACTIVE_TTL_SECONDS = 60 * 60 * 24 * 365 * 2;
const PAID_TTL_SECONDS = ACTIVE_TTL_SECONDS;

function activeKey(id: string): string {
  return `railfi:invoice:${id}`;
}

function metaKey(id: string): string {
  return `railfi:invoice_meta:${id}`;
}

function creatorKey(wallet: string): string {
  return `railfi:creator:${wallet}`;
}

function getExpiryTtl(expiresAt: number | null, now = Math.floor(Date.now() / 1000)): number {
  if (!expiresAt) {
    return ACTIVE_TTL_SECONDS;
  }

  return Math.max(expiresAt - now, 1);
}

function normalizeInvoiceStatus(invoice: InvoiceRecord, now = Math.floor(Date.now() / 1000)): InvoiceRecord {
  if (invoice.status === "OPEN" && invoice.expiresAt && invoice.expiresAt <= now) {
    return { ...invoice, status: "EXPIRED" };
  }

  return invoice;
}

async function readInvoiceLike(key: string): Promise<InvoiceRecord | null> {
  try {
    const redis = getServerRedis("invoice storage");
    const invoice = await redis.get<InvoiceRecord>(key);
    return invoice ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Redis read error.";
    throw new Error(`Failed to read invoice data: ${message}`);
  }
}

export async function createInvoice(id: string, input: CreateInvoiceInput): Promise<InvoiceRecord> {
  const now = Math.floor(Date.now() / 1000);
  const invoice: InvoiceRecord = {
    id,
    creatorWallet: input.creatorWallet,
    amount: input.amount,
    description: input.description,
    destinationUpiId: input.destinationUpiId,
    createdAt: now,
    expiresAt: input.expiresAt,
    status: "OPEN",
    paidAt: null,
    paidByWallet: null,
    offrampTxSig: null,
  };

  const ttlSeconds = getExpiryTtl(invoice.expiresAt, now);

  try {
    const redis = getServerRedis("invoice storage");
    await Promise.all([
      redis.setex(activeKey(id), ttlSeconds, invoice),
      redis.setex(metaKey(id), ACTIVE_TTL_SECONDS, invoice),
      redis.sadd(creatorKey(input.creatorWallet), id),
      redis.expire(creatorKey(input.creatorWallet), ACTIVE_TTL_SECONDS),
    ]);
    return invoice;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Redis write error.";
    throw new Error(`Failed to create invoice: ${message}`);
  }
}

export async function getInvoice(id: string): Promise<InvoiceRecord | null> {
  try {
    const active = await readInvoiceLike(activeKey(id));
    if (active) {
      return normalizeInvoiceStatus(active);
    }

    const archived = await readInvoiceLike(metaKey(id));
    if (!archived) {
      return null;
    }

    return normalizeInvoiceStatus(archived);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Redis read error.";
    throw new Error(`Failed to load invoice: ${message}`);
  }
}

export async function getInvoicesByCreator(wallet: string): Promise<InvoiceRecord[]> {
  try {
    const redis = getServerRedis("invoice storage");
    const ids = await redis.smembers<string[]>(creatorKey(wallet));
    if (!ids || ids.length === 0) {
      return [];
    }

    const invoices = await Promise.all(ids.map((id) => getInvoice(id)));
    const deadIds = ids.filter((_, index) => invoices[index] === null);
    if (deadIds.length > 0) {
      await redis.srem(creatorKey(wallet), ...deadIds);
    }

    return invoices
      .filter((invoice): invoice is InvoiceRecord => invoice !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Redis read error.";
    throw new Error(`Failed to load creator invoices: ${message}`);
  }
}

export async function markInvoicePaid(
  id: string,
  input: MarkInvoicePaidInput,
): Promise<InvoiceRecord | null> {
  const current = await getInvoice(id);
  if (!current) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const normalized = normalizeInvoiceStatus(current, now);

  if (normalized.status !== "OPEN") {
    return normalized;
  }

  const next: InvoiceRecord = {
    ...normalized,
    status: "PAID",
    paidAt: now,
    paidByWallet: input.paidByWallet,
    offrampTxSig: input.offrampTxSig,
  };

  try {
    const redis = getServerRedis("invoice storage");
    await Promise.all([
      redis.setex(activeKey(id), PAID_TTL_SECONDS, next),
      redis.setex(metaKey(id), PAID_TTL_SECONDS, next),
      redis.sadd(creatorKey(next.creatorWallet), id),
      redis.expire(creatorKey(next.creatorWallet), PAID_TTL_SECONDS),
    ]);
    return next;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Redis write error.";
    throw new Error(`Failed to mark invoice paid: ${message}`);
  }
}

export function getInvoiceResponseStatus(invoice: InvoiceRecord | null): InvoiceStatus | null {
  if (!invoice) {
    return null;
  }

  return invoice.status;
}
