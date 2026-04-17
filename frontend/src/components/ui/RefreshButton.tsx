"use client";

import { useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";

export function RefreshButton({
  onRefresh,
  successMessage = "Ledger synced",
  errorMessage = "Transaction failed - check wallet",
  className,
  onSuccess,
}: {
  onRefresh: () => Promise<void>;
  successMessage?: string;
  errorMessage?: string;
  className?: string;
  onSuccess?: () => void;
}) {
  const { showToast } = useToast();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  return (
    <button
      type="button"
      disabled={state === "loading"}
      className={cn("btn-ghost", className)}
      onClick={async () => {
        if (state === "loading") {
          return;
        }

        setState("loading");
        try {
          await onRefresh();
          setState("done");
          showToast(successMessage, "success");
          onSuccess?.();
          window.setTimeout(() => setState("idle"), 1500);
        } catch {
          setState("idle");
          showToast(errorMessage, "error");
        }
      }}
    >
      {state === "done" ? (
        <Check className="h-3.5 w-3.5 text-[var(--green)]" />
      ) : (
        <RefreshCw className={cn("h-3.5 w-3.5 refresh-icon", state === "loading" && "loading")} />
      )}
      {state === "loading" ? "Syncing..." : state === "done" ? "Synced" : "Refresh"}
    </button>
  );
}
