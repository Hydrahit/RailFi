import type { UpiValidationResponse } from "@/types/railpay";
import {
  isValidUpiFormat as sharedIsValidUpiFormat,
  normalizeUpiId,
} from "@/lib/upi";

export function isValidUpiFormat(upiId: string): boolean {
  return sharedIsValidUpiFormat(upiId);
}

export function upiBank(upiId: string): string {
  const parts = upiId.split("@");
  return parts[1] ?? "";
}

export async function validateUpi(
  upiId: string,
  signal?: AbortSignal,
): Promise<UpiValidationResponse> {
  const trimmed = normalizeUpiId(upiId);

  if (!isValidUpiFormat(trimmed)) {
    return {
      isValid: false,
      vpa: trimmed,
      error: "Invalid UPI ID format (example: name@upi)",
    };
  }

  try {
    const response = await fetch(
      `/api/validate-upi?vpa=${encodeURIComponent(trimmed)}`,
      { signal, cache: "no-store" },
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data: UpiValidationResponse = await response.json();
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    return {
      isValid: false,
      vpa: trimmed,
      error: "UPI verification is unavailable. Please try again.",
    };
  }
}
