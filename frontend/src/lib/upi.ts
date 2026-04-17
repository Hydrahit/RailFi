const UPI_REGEX = /^[a-zA-Z0-9._-]{2,32}@[a-zA-Z]{2,32}$/;

export function normalizeUpiId(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUpiFormat(value: string): boolean {
  return UPI_REGEX.test(value.trim());
}

export function assertValidUpiId(value: string): string {
  const normalized = normalizeUpiId(value);
  if (!isValidUpiFormat(normalized)) {
    throw new Error("Invalid UPI ID format.");
  }
  return normalized;
}

export async function hashUpiId(value: string): Promise<Uint8Array> {
  const normalized = assertValidUpiId(value);
  const payload = new TextEncoder().encode(normalized);

  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", payload);
    return new Uint8Array(digest);
  }

  const { createHash } = await import("crypto");
  return new Uint8Array(createHash("sha256").update(payload).digest());
}

export function equalByteArrays(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

