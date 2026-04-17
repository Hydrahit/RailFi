"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useToast } from "@/hooks/useToast";
import { useHybridAuth } from "@/hooks/useHybridAuth";

export function HybridAuthBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const { showToast } = useToast();
  const {
    authState,
    pendingIntent,
    completeWalletLink,
    refreshAuthState,
    clearAuthIntent,
  } = useHybridAuthBridgeInternals();

  const attemptKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingIntent) {
      return;
    }

    const attemptKey = `${pendingIntent.mode}:${pendingIntent.callbackUrl}`;
    if (attemptKeyRef.current === attemptKey) {
      return;
    }

    if (!authState?.googleSessionActive || !authState.walletSessionAuthenticated) {
      return;
    }

    if (authState.identityBound) {
      clearAuthIntent();
      if (pathname !== pendingIntent.callbackUrl) {
        router.replace(pendingIntent.callbackUrl);
      }
      return;
    }

    attemptKeyRef.current = attemptKey;

    void (async () => {
      try {
        const next = await completeWalletLink();
        clearAuthIntent();
        if (next.identityBound && pathname !== pendingIntent.callbackUrl) {
          router.replace(pendingIntent.callbackUrl);
          return;
        }

        router.refresh();
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Unable to complete Google and wallet linking.";
        showToast(message, "error");
        clearAuthIntent();
        await refreshAuthState().catch(() => undefined);
      } finally {
        attemptKeyRef.current = null;
      }
    })();
  }, [
    authState,
    clearAuthIntent,
    completeWalletLink,
    pathname,
    pendingIntent,
    refreshAuthState,
    router,
    showToast,
  ]);

  return null;
}

function useHybridAuthBridgeInternals() {
  return useHybridAuth();
}
