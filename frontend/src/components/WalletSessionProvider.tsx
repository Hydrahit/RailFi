"use client";

import bs58 from "bs58";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { buildWalletSessionAuthMessage } from "@/lib/wallet-session";

interface WalletSessionResponse {
  authenticated: boolean;
  walletAddress: string | null;
  expiresAt: number | null;
}

interface WalletSessionCreateResponse {
  walletAddress: string;
  expiresAt: number;
}

interface WalletSessionContextValue {
  sessionWallet: string | null;
  isAuthenticating: boolean;
  ensureSession: () => Promise<string>;
  clearSession: () => Promise<void>;
}

const WalletSessionContext = createContext<WalletSessionContextValue | null>(null);
const SESSION_VERIFY_TTL_MS = 10 * 60 * 1000;

function randomNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function WalletSessionProvider({ children }: PropsWithChildren) {
  const { publicKey, connected, signMessage } = useWallet();
  const [sessionWallet, setSessionWallet] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const pendingPromiseRef = useRef<Promise<string> | null>(null);
  const lastVerifiedAtRef = useRef(0);
  const syncRequestIdRef = useRef(0);
  const isMountedRef = useRef(false);
  const publicKeyBase58 = publicKey?.toBase58() ?? null;
  const resetSessionState = useCallback(() => {
    if (!isMountedRef.current) {
      return;
    }
    setSessionWallet(null);
    lastVerifiedAtRef.current = 0;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const syncServerSession = useCallback(async (): Promise<string | null> => {
    const requestId = ++syncRequestIdRef.current;
    const response = await fetch("/api/auth/wallet/session", {
      method: "GET",
      cache: "no-store",
    });

    const payload = (await response.json()) as WalletSessionResponse | { error?: string };
    if (!response.ok || !("authenticated" in payload)) {
      throw new Error("error" in payload ? payload.error ?? "Session sync failed." : "Session sync failed.");
    }

    if (!payload.authenticated || !payload.walletAddress) {
      if (isMountedRef.current && requestId === syncRequestIdRef.current) {
        resetSessionState();
      }
      return null;
    }

    if (isMountedRef.current && requestId === syncRequestIdRef.current) {
      setSessionWallet(payload.walletAddress);
      lastVerifiedAtRef.current = Date.now();
    }
    return payload.walletAddress;
  }, [resetSessionState]);

  const clearSession = useCallback(async () => {
    try {
      await fetch("/api/auth/wallet/session", {
        method: "DELETE",
      });
    } finally {
      resetSessionState();
    }
  }, [resetSessionState]);

  useEffect(() => {
    if (!connected || !publicKeyBase58) {
      resetSessionState();
      return;
    }

    void syncServerSession().catch(() => {
      console.warn("[WalletSessionProvider] Session sync failed; preserving current auth state.");
    });
  }, [connected, publicKeyBase58, resetSessionState, syncServerSession]);

  useEffect(() => {
    if (!connected || !publicKeyBase58) {
      void clearSession();
      return;
    }

    if (sessionWallet && sessionWallet !== publicKeyBase58) {
      void clearSession();
    }
  }, [clearSession, connected, publicKeyBase58, sessionWallet]);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (!connected || !publicKeyBase58) {
      throw new Error("Connect your wallet to continue.");
    }

    if (!signMessage) {
      throw new Error("This wallet does not support message signing.");
    }

    const isFresh =
      sessionWallet === publicKeyBase58 &&
      Date.now() - lastVerifiedAtRef.current < SESSION_VERIFY_TTL_MS;
    if (isFresh) {
      return publicKeyBase58;
    }

    if (pendingPromiseRef.current) {
      return pendingPromiseRef.current;
    }

    const promise = (async () => {
      if (isMountedRef.current) {
        setIsAuthenticating(true);
      }

      try {
        const existingWallet = await syncServerSession().catch((error) => {
          console.warn("[WalletSessionProvider] Session preflight sync failed:", error);
          return null;
        });
        if (existingWallet && existingWallet === publicKeyBase58) {
          return existingWallet;
        }

        const nonce = randomNonce();
        const signedAt = Math.floor(Date.now() / 1000);
        const message = buildWalletSessionAuthMessage({
          walletAddress: publicKeyBase58,
          nonce,
          signedAt,
          origin: window.location.origin,
        });
        const signature = bs58.encode(
          await signMessage(new TextEncoder().encode(message)),
        );

        const response = await fetch("/api/auth/wallet/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletAddress: publicKeyBase58,
            nonce,
            signedAt,
            signature,
          }),
        });
        const payload = (await response.json()) as WalletSessionCreateResponse | { error?: string };
        if (!response.ok || !("walletAddress" in payload)) {
          throw new Error("error" in payload ? payload.error ?? "Wallet session failed." : "Wallet session failed.");
        }

        const authenticatedWallet = payload.walletAddress;
        if (isMountedRef.current) {
          setSessionWallet(authenticatedWallet);
        }
        lastVerifiedAtRef.current = Date.now();
        return authenticatedWallet;
      } finally {
        if (isMountedRef.current) {
          setIsAuthenticating(false);
        }
        pendingPromiseRef.current = null;
      }
    })();

    pendingPromiseRef.current = promise;
    return promise;
  }, [connected, publicKeyBase58, sessionWallet, signMessage, syncServerSession]);

  const value = useMemo<WalletSessionContextValue>(
    () => ({
      sessionWallet,
      isAuthenticating,
      ensureSession,
      clearSession,
    }),
    [clearSession, ensureSession, isAuthenticating, sessionWallet],
  );

  return <WalletSessionContext.Provider value={value}>{children}</WalletSessionContext.Provider>;
}

export function useWalletSession(): WalletSessionContextValue {
  const context = useContext(WalletSessionContext);
  if (!context) {
    throw new Error("useWalletSession must be used within WalletSessionProvider.");
  }
  return context;
}
