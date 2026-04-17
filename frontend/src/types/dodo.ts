// src/types/dodo.ts
// Shared types for the Dodo Payments integration layer.
// Do not modify existing types elsewhere to accommodate these.

/**
 * The subset of Dodo's payment.succeeded webhook payload that RailFi consumes.
 * Dodo sends amount in the smallest currency unit (cents for USD).
 */
export interface DodoPaymentSucceededData {
  payment_id: string;
  customer: {
    email: string;
    name: string;
    customer_id: string;
  };
  amount: number; // cents
  currency: string; // e.g. "USD"
  status: string; // "succeeded"
  created_at: string; // ISO 8601
  metadata?: Record<string, string>;
}

export interface DodoWebhookPayload {
  event_type: "payment.succeeded" | "payment.failed" | "refund.created" | string;
  data: DodoPaymentSucceededData;
  webhook_id: string;
  timestamp: string;
}

/**
 * The RailFi-internal off-ramp intent record staged in Redis
 * after a Dodo webhook is received.
 *
 * Redis key: railfi:dodo:intent:{dodoPaymentId}
 * TTL: 3600s (1 hour) - extends to 86400s after claim
 */
export type DodoIntentStatus =
  | "PENDING_WALLET_LINK"
  | "READY_FOR_RELAY"
  | "RELAY_EXECUTING"
  | "RELAY_SUBMITTED"
  | "SETTLED"
  | "FAILED";

export interface DodoOfframpIntent {
  dodoPaymentId: string;
  customerEmail: string;
  customerName: string;
  amountUsd: number;
  currency: string;
  status: DodoIntentStatus;
  createdAt: number;
  walletAddress?: string;
  upiHandle?: string;
  usdcAmount?: number;
  inrQuote?: number;
  claimedAt?: number;
  executionLockToken?: string;
  executionStartedAt?: number;
  lastExecutionError?: string;
  transferId?: string;
  solanaTx?: string;
  executedAt?: number;
  failureReason?: string;
  retryCount?: number;
  lastRetryAt?: number;
}
