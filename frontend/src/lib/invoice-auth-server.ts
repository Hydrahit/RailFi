import "server-only";

import { Buffer } from "buffer";
import { createPublicKey, verify } from "crypto";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyWalletSignature(
  walletAddress: string,
  message: string,
  signature: string,
): boolean {
  try {
    const publicKey = new PublicKey(walletAddress);
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey.toBytes())]),
      format: "der",
      type: "spki",
    });

    return verify(
      null,
      Buffer.from(message, "utf8"),
      key,
      Buffer.from(bs58.decode(signature)),
    );
  } catch {
    return false;
  }
}

export const verifyInvoiceSignature = verifyWalletSignature;
