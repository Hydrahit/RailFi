// src/lib/dodo.ts
// Singleton Dodo Payments SDK client.
// Import this wherever you need to call the Dodo API.

import DodoPayments from "dodopayments";

if (!process.env.DODO_PAYMENTS_API_KEY) {
  throw new Error(
    "[RailFi] DODO_PAYMENTS_API_KEY is not set. " +
    "Add it to .env.local before starting the dev server.",
  );
}

export const dodo = new DodoPayments({
  bearerToken: process.env.DODO_PAYMENTS_API_KEY,
  environment:
    process.env.NODE_ENV === "production" ? "live_mode" : "test_mode",
});
