"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/useToast";
import { useHybridAuth } from "@/hooks/useHybridAuth";

interface GoogleSignInButtonProps {
  callbackUrl: string;
  className?: string;
  children: React.ReactNode;
  preferWalletFirst?: boolean;
}

export function GoogleSignInButton({
  callbackUrl,
  className,
  children,
  preferWalletFirst = true,
}: GoogleSignInButtonProps) {
  const { showToast } = useToast();
  const { startGoogleSignIn, isAuthenticatingWallet, isRefreshing, isLinking } = useHybridAuth();
  const [isStarting, setIsStarting] = useState(false);

  const handleClick = async () => {
    setIsStarting(true);
    try {
      await startGoogleSignIn({ callbackUrl, preferWalletFirst });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unable to start Google sign-in.";
      if (message !== "Redirecting to Google sign-in...") {
        showToast(message, "error");
      }
      setIsStarting(false);
    }
  };

  const disabled = isStarting || isAuthenticatingWallet || isRefreshing || isLinking;

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={disabled}
      className={className}
    >
      {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}
