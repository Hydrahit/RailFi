"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useWalletSession } from "@/components/WalletSessionProvider";

export interface HybridAuthState {
  googleLinked: boolean;
  walletLinked: boolean;
  walletAddress: string | null;
  kycTier: number;
  googleSessionActive: boolean;
  walletSessionAuthenticated: boolean;
  nextAuthWalletAddress: string | null;
  identityBound: boolean;
}

interface ApiErrorPayload {
  error?: string;
}

interface AuthIntentRecord {
  callbackUrl: string;
  mode: "wallet-first" | "google-first";
  createdAt: number;
}

const HYBRID_AUTH_INTENT_KEY = "railfi:hybrid-auth:intent";

async function parseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as ApiErrorPayload).error === "string" &&
    (payload as ApiErrorPayload).error?.trim()
  ) {
    return (payload as ApiErrorPayload).error as string;
  }

  return fallback;
}

function readAuthIntent(): AuthIntentRecord | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(HYBRID_AUTH_INTENT_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as AuthIntentRecord;
    if (!parsed?.callbackUrl || !parsed?.mode) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeAuthIntent(intent: AuthIntentRecord): void {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(HYBRID_AUTH_INTENT_KEY, JSON.stringify(intent));
}

function clearAuthIntent(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(HYBRID_AUTH_INTENT_KEY);
}

export function useHybridAuth() {
  const pathname = usePathname();
  const { ensureSession, sessionWallet, isAuthenticating } = useWalletSession();
  const [authState, setAuthState] = useState<HybridAuthState | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  const refreshAuthState = useCallback(async (): Promise<HybridAuthState> => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/auth/session-state", {
        cache: "no-store",
        credentials: "include",
      });
      const payload = await parseJson<HybridAuthState | ApiErrorPayload>(response);

      if (!response.ok || !payload || !("googleLinked" in payload)) {
        throw new Error(getApiErrorMessage(payload, "Unable to verify your RailFi session."));
      }

      setAuthState(payload);
      return payload;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuthState().catch(() => {
      setAuthState(null);
    });
  }, [refreshAuthState, sessionWallet]);

  const ensureWalletSession = useCallback(async (): Promise<string> => {
    const walletAddress = await ensureSession();
    await refreshAuthState().catch(() => undefined);
    return walletAddress;
  }, [ensureSession, refreshAuthState]);

  const startGoogleSignIn = useCallback(
    async (options?: { callbackUrl?: string; preferWalletFirst?: boolean }) => {
      const callbackUrl = options?.callbackUrl ?? pathname ?? "/dashboard";
      const preferWalletFirst = options?.preferWalletFirst ?? true;

      writeAuthIntent({
        callbackUrl,
        mode: preferWalletFirst && !!sessionWallet ? "wallet-first" : "google-first",
        createdAt: Date.now(),
      });

      if (preferWalletFirst && sessionWallet) {
        const response = await fetch("/api/auth/link-google", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ callbackUrl }),
        });
        const payload = await parseJson<{ redirectUrl?: string } | ApiErrorPayload>(response);

        if (!response.ok || !payload || !("redirectUrl" in payload) || !payload.redirectUrl) {
          throw new Error(getApiErrorMessage(payload, "Unable to start Google sign-in."));
        }

        window.location.href = payload.redirectUrl;
        return;
      }

      const url = new URL("/api/auth/signin/google", window.location.origin);
      url.searchParams.set("callbackUrl", callbackUrl);
      window.location.href = url.toString();
    },
    [pathname, sessionWallet],
  );

  const ensureGoogleSession = useCallback(
    async (options?: { callbackUrl?: string; preferWalletFirst?: boolean }) => {
      const next = authState ?? (await refreshAuthState());
      if (next.googleSessionActive) {
        return next;
      }

      await startGoogleSignIn(options);
      throw new Error("Redirecting to Google sign-in...");
    },
    [authState, refreshAuthState, startGoogleSignIn],
  );

  const completeWalletLink = useCallback(async (): Promise<HybridAuthState> => {
    setIsLinking(true);
    try {
      const response = await fetch("/api/auth/link-wallet", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const payload = await parseJson<{ linked?: boolean } | ApiErrorPayload>(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "Unable to complete wallet linking."));
      }

      const next = await refreshAuthState();
      return next;
    } finally {
      setIsLinking(false);
    }
  }, [refreshAuthState]);

  const ensureLinkedIdentity = useCallback(
    async (options?: { callbackUrl?: string; preferWalletFirst?: boolean }) => {
      let next = authState ?? (await refreshAuthState());

      if (!next.googleSessionActive) {
        await startGoogleSignIn(options);
        throw new Error("Redirecting to Google sign-in...");
      }

      if (!next.walletSessionAuthenticated) {
        await ensureWalletSession();
        next = await refreshAuthState();
      }

      if (!next.identityBound) {
        next = await completeWalletLink();
      }

      return next;
    },
    [
      authState,
      completeWalletLink,
      ensureWalletSession,
      refreshAuthState,
      startGoogleSignIn,
    ],
  );

  const pendingIntent = useMemo(() => readAuthIntent(), [authState, pathname]);

  return {
    authState,
    isRefreshing,
    isAuthenticatingWallet: isAuthenticating,
    isLinking,
    pendingIntent,
    refreshAuthState,
    ensureWalletSession,
    ensureGoogleSession,
    ensureLinkedIdentity,
    completeWalletLink,
    startGoogleSignIn,
    clearAuthIntent,
    readAuthIntent,
  };
}
