import "server-only";

import { isTrustedOrigin } from "@/lib/origin";

// SECURITY: Validates that mutating identity requests originate from the RailFi app to block CSRF.
export function validateTrustedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin")?.trim() ?? null;
  return isTrustedOrigin(origin);
}
