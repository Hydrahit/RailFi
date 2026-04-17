export const INVOICE_AUTH_WINDOW_SECONDS = 5 * 60;

interface CreateInvoiceAuthMessageArgs {
  creatorWallet: string;
  amount: number;
  description: string;
  destinationUpiId: string;
  expiresAt: number | null;
  signedAt: number;
}

interface InvoicePayContextAuthMessageArgs {
  invoiceId: string;
  wallet: string;
  signedAt: number;
}

export function isRecentInvoiceAuthTimestamp(
  signedAt: number,
  now = Math.floor(Date.now() / 1000),
): boolean {
  return (
    Number.isInteger(signedAt) &&
    signedAt > 0 &&
    signedAt <= now + 60 &&
    signedAt >= now - INVOICE_AUTH_WINDOW_SECONDS
  );
}

export function buildCreateInvoiceAuthMessage({
  creatorWallet,
  amount,
  description,
  destinationUpiId,
  expiresAt,
  signedAt,
}: CreateInvoiceAuthMessageArgs): string {
  return [
    "RailFi Invoice Authorization",
    "Action: create_invoice",
    `Creator Wallet: ${creatorWallet}`,
    `Amount USDC: ${amount.toFixed(6)}`,
    `Description: ${description || "(empty)"}`,
    `Settlement UPI: ${destinationUpiId}`,
    `Expires At: ${expiresAt ?? "null"}`,
    `Signed At: ${signedAt}`,
  ].join("\n");
}

export function buildInvoicePayContextAuthMessage({
  invoiceId,
  wallet,
  signedAt,
}: InvoicePayContextAuthMessageArgs): string {
  return [
    "RailFi Invoice Checkout Authorization",
    "Action: request_settlement_destination",
    `Invoice ID: ${invoiceId}`,
    `Wallet: ${wallet}`,
    `Signed At: ${signedAt}`,
  ].join("\n");
}
