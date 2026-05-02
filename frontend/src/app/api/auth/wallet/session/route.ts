import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { verifyWalletSignature } from "@/lib/invoice-auth-server";
import {
  buildWalletSessionAuthMessage,
  isRecentWalletSessionTimestamp,
} from "@/lib/wallet-session";
import {
  attachWalletSessionCookie,
  clearWalletSessionCookie,
  consumeWalletSessionNonce,
  createWalletSession,
  deleteWalletSession,
  getWalletSessionFromRequest,
  touchWalletSession,
} from "@/lib/wallet-session-server";
import { enforceIpRateLimit } from "@/lib/rate-limit";
import { requireTrustedOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WalletSessionPostBody {
  walletAddress: string;
  nonce: string;
  signedAt: number;
  signature: string;
}

const NONCE_MAX_LENGTH = 128;
const SIGNATURE_MAX_LENGTH = 256;

function buildUnauthenticatedSessionResponse(): NextResponse {
  return NextResponse.json(
    {
      authenticated: false,
      walletAddress: null,
      expiresAt: null,
    },
    { status: 200 },
  );
}

function validateWallet(walletAddress: string): boolean {
  try {
    new PublicKey(walletAddress);
    return true;
  } catch {
    return false;
  }
}

function parseWalletSessionBody(value: unknown): WalletSessionPostBody | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const walletAddress =
    typeof (value as { walletAddress?: unknown }).walletAddress === "string"
      ? (value as { walletAddress: string }).walletAddress.trim()
      : "";
  const nonce =
    typeof (value as { nonce?: unknown }).nonce === "string"
      ? (value as { nonce: string }).nonce.trim()
      : "";
  const signature =
    typeof (value as { signature?: unknown }).signature === "string"
      ? (value as { signature: string }).signature.trim()
      : "";
  const signedAt = Number((value as { signedAt?: unknown }).signedAt);

  if (
    !walletAddress ||
    !nonce ||
    nonce.length > NONCE_MAX_LENGTH ||
    !signature ||
    signature.length > SIGNATURE_MAX_LENGTH ||
    !Number.isInteger(signedAt)
  ) {
    return null;
  }

  return { walletAddress, nonce, signedAt, signature };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originViolation = requireTrustedOrigin(request);
  if (originViolation) {
    return originViolation;
  }

  const ipLimit = await enforceIpRateLimit(
    request,
    "walletSessionIp",
    "Too many wallet-session requests. Please try again later.",
  );
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: ipLimit.message }, { status: 429 });
  }

  try {
    const body = parseWalletSessionBody(await request.json());
    if (!body) {
      return NextResponse.json(
        { error: "A recent wallet signature is required to create a session." },
        { status: 401 },
      );
    }

    const { walletAddress, nonce, signedAt, signature } = body;

    if (
      !validateWallet(walletAddress) ||
      !nonce ||
      !signature ||
      !isRecentWalletSessionTimestamp(signedAt)
    ) {
      return NextResponse.json(
        { error: "A recent wallet signature is required to create a session." },
        { status: 401 },
      );
    }

    const expectedMessage = buildWalletSessionAuthMessage({
      walletAddress,
      nonce,
      signedAt,
      origin: new URL(request.url).origin,
    });
    if (!verifyWalletSignature(walletAddress, expectedMessage, signature)) {
      return NextResponse.json({ error: "Wallet session signature is invalid." }, { status: 401 });
    }

    // SECURITY: Treat signedAt as the SIWS issuedAt equivalent so a valid stale signature cannot be replayed before nonce consumption.
    const SIWS_MAX_AGE_MS = 5 * 60 * 1000;
    const issuedAt = signedAt;
    const now = Date.now();
    if (!Number.isFinite(issuedAt) || Math.abs(now - issuedAt) > SIWS_MAX_AGE_MS) {
      return NextResponse.json(
        { error: "Signature expired or not yet valid. Please sign again." },
        { status: 401 },
      );
    }

    const nonceAccepted = await consumeWalletSessionNonce(walletAddress, nonce);
    if (!nonceAccepted) {
      return NextResponse.json(
        { error: "Wallet session authorization has already been used." },
        { status: 409 },
      );
    }

    const session = await createWalletSession(walletAddress);
    const response = NextResponse.json(
      {
        walletAddress: session.walletAddress,
        expiresAt: session.record.expiresAt,
      },
      { status: 200 },
    );
    return attachWalletSessionCookie(response, session.sessionId);
  } catch (error) {
    console.error("[wallet-session] create failed:", error);
    return NextResponse.json({ error: "Failed to create wallet session." }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const ipLimit = await enforceIpRateLimit(
    request,
    "walletSessionIp",
    "Too many wallet-session requests. Please try again later.",
  );
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: ipLimit.message }, { status: 429 });
  }

  try {
    const session = await getWalletSessionFromRequest(request);
    if (!session) {
      return buildUnauthenticatedSessionResponse();
    }

    const refreshed = await touchWalletSession(session.sessionId);
    if (!refreshed) {
      const expired = buildUnauthenticatedSessionResponse();
      return clearWalletSessionCookie(expired);
    }

    const response = NextResponse.json(
      {
        authenticated: true,
        walletAddress: refreshed.walletAddress,
        expiresAt: refreshed.record.expiresAt,
      },
      { status: 200 },
    );
    return attachWalletSessionCookie(response, refreshed.sessionId);
  } catch (error) {
    console.error("[wallet-session] load failed:", error);
    return NextResponse.json({ error: "Failed to load wallet session." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const originViolation = requireTrustedOrigin(request);
  if (originViolation) {
    return originViolation;
  }

  const ipLimit = await enforceIpRateLimit(
    request,
    "walletSessionIp",
    "Too many wallet-session requests. Please try again later.",
  );
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: ipLimit.message }, { status: 429 });
  }

  try {
    const session = await getWalletSessionFromRequest(request);
    if (session) {
      await deleteWalletSession(session.sessionId);
    }

    const response = NextResponse.json({ cleared: true }, { status: 200 });
    return clearWalletSessionCookie(response);
  } catch (error) {
    console.error("[wallet-session] clear failed:", error);
    return NextResponse.json({ error: "Failed to clear wallet session." }, { status: 500 });
  }
}
