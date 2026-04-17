export const WALLET_SESSION_COOKIE = "railpay_wallet_session";
export const WALLET_SESSION_TTL_SECONDS = 30 * 60;
export const WALLET_SESSION_AUTH_WINDOW_SECONDS = 5 * 60;

interface WalletSessionAuthMessageArgs {
  walletAddress: string;
  nonce: string;
  signedAt: number;
  origin: string;
}

export function buildWalletSessionAuthMessage({
  walletAddress,
  nonce,
  signedAt,
  origin,
}: WalletSessionAuthMessageArgs): string {
  return [
    "RailFi Wallet Session Authorization",
    "Action: create_wallet_session",
    `Origin: ${origin}`,
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Signed At: ${signedAt}`,
  ].join("\n");
}

export function isRecentWalletSessionTimestamp(
  signedAt: number,
  now = Math.floor(Date.now() / 1000),
): boolean {
  return (
    Number.isInteger(signedAt) &&
    signedAt > 0 &&
    signedAt <= now + 60 &&
    signedAt >= now - WALLET_SESSION_AUTH_WINDOW_SECONDS
  );
}
