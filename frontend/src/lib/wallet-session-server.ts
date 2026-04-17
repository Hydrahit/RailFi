import "server-only";

import { randomUUID } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import {
  WALLET_SESSION_AUTH_WINDOW_SECONDS,
  WALLET_SESSION_COOKIE,
  WALLET_SESSION_TTL_SECONDS,
} from "@/lib/wallet-session";
import { getServerRedis } from "@/lib/upstash";

export interface WalletSessionRecord {
  walletAddress: string;
  createdAt: number;
  lastRefreshedAt: number;
  expiresAt: number;
}

export interface WalletSession {
  sessionId: string;
  walletAddress: string;
  record: WalletSessionRecord;
}

const SESSION_REFRESH_GRACE_SECONDS = 5 * 60;

function sessionKey(sessionId: string): string {
  return `railfi:wallet-session:${sessionId}`;
}

function nonceKey(walletAddress: string, nonce: string): string {
  return `railfi:wallet-session-nonce:${walletAddress}:${nonce}`;
}

function buildRecord(walletAddress: string, now = Math.floor(Date.now() / 1000)): WalletSessionRecord {
  return {
    walletAddress,
    createdAt: now,
    lastRefreshedAt: now,
    expiresAt: now + WALLET_SESSION_TTL_SECONDS,
  };
}

export async function consumeWalletSessionNonce(
  walletAddress: string,
  nonce: string,
): Promise<boolean> {
  const redis = getServerRedis("wallet session auth");
  const result = await redis.set(
    nonceKey(walletAddress, nonce),
    "1",
    {
      nx: true,
      ex: WALLET_SESSION_AUTH_WINDOW_SECONDS + 60,
    },
  );

  return result === "OK";
}

export async function createWalletSession(walletAddress: string): Promise<WalletSession> {
  const redis = getServerRedis("wallet sessions");
  const sessionId = randomUUID();
  const record = buildRecord(walletAddress);
  await redis.setex(sessionKey(sessionId), WALLET_SESSION_TTL_SECONDS, record);
  return { sessionId, walletAddress, record };
}

export async function readWalletSession(sessionId: string): Promise<WalletSession | null> {
  const redis = getServerRedis("wallet sessions");
  const record = await redis.get<WalletSessionRecord>(sessionKey(sessionId));
  if (!record) {
    return null;
  }

  return {
    sessionId,
    walletAddress: record.walletAddress,
    record,
  };
}

export async function touchWalletSession(sessionId: string): Promise<WalletSession | null> {
  const current = await readWalletSession(sessionId);
  if (!current) {
    return null;
  }

  return touchWalletSessionRecord(current);
}

async function touchWalletSessionRecord(current: WalletSession): Promise<WalletSession | null> {
  const sessionId = current.sessionId;

  const now = Math.floor(Date.now() / 1000);
  if (current.record.expiresAt - now > SESSION_REFRESH_GRACE_SECONDS) {
    return current;
  }

  const redis = getServerRedis("wallet sessions");
  const next: WalletSessionRecord = {
    ...current.record,
    lastRefreshedAt: now,
    expiresAt: now + WALLET_SESSION_TTL_SECONDS,
  };
  await redis.setex(sessionKey(sessionId), WALLET_SESSION_TTL_SECONDS, next);

  return {
    sessionId,
    walletAddress: current.walletAddress,
    record: next,
  };
}

export async function deleteWalletSession(sessionId: string): Promise<void> {
  const redis = getServerRedis("wallet sessions");
  await redis.del(sessionKey(sessionId));
}

export async function getWalletSessionFromRequest(
  request: NextRequest,
): Promise<WalletSession | null> {
  const sessionId = request.cookies.get(WALLET_SESSION_COOKIE)?.value?.trim();
  if (!sessionId) {
    return null;
  }

  return readWalletSession(sessionId);
}

export async function getWalletSessionFromCookies(
  cookies: Pick<ReadonlyRequestCookies, "get">,
): Promise<WalletSession | null> {
  const sessionId = cookies.get(WALLET_SESSION_COOKIE)?.value?.trim();
  if (!sessionId) {
    return null;
  }

  return readWalletSession(sessionId);
}

export async function getRefreshedWalletSessionFromRequest(
  request: NextRequest,
): Promise<WalletSession | null> {
  const current = await getWalletSessionFromRequest(request);
  if (!current) {
    return null;
  }

  return touchWalletSessionRecord(current);
}

export function attachWalletSessionCookie(
  response: NextResponse,
  sessionId: string,
): NextResponse {
  response.cookies.set({
    name: WALLET_SESSION_COOKIE,
    value: sessionId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WALLET_SESSION_TTL_SECONDS,
  });
  return response;
}

export function clearWalletSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: WALLET_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
