"use client";

import { AlertCircle, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastType = "success" | "error";

export function Toast({
  message,
  type,
}: {
  message: string;
  type: ToastType;
}) {
  return (
    <div className={cn("toast", type)}>
      {type === "success" ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
      <span>{message}</span>
    </div>
  );
}
