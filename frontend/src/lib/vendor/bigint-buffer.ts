type BigintBufferConverter = {
  toBigInt: (buf: Buffer, bigEndian?: boolean) => bigint;
  fromBigInt: (num: bigint, buf: Buffer, bigEndian?: boolean) => Buffer;
};

let converter: BigintBufferConverter | undefined;

if (typeof window === "undefined") {
  try {
    const runtimeRequire = eval("require") as NodeRequire;
    const path = runtimeRequire("path") as typeof import("path");
    const bindings = runtimeRequire("bindings") as (options: {
      bindings: string;
      module_root: string;
    }) => BigintBufferConverter;

    converter = bindings({
      bindings: "bigint_buffer",
      module_root: path.join(process.cwd(), "node_modules", "bigint-buffer"),
    });
  } catch {
    converter = undefined;
  }
}

export function toBigIntLE(buf: Buffer): bigint {
  if (!converter) {
    const reversed = Buffer.from(buf);
    reversed.reverse();
    const hex = reversed.toString("hex");
    if (hex.length === 0) {
      return BigInt(0);
    }
    return BigInt(`0x${hex}`);
  }

  return converter.toBigInt(buf, false);
}

export function toBigIntBE(buf: Buffer): bigint {
  if (!converter) {
    const hex = buf.toString("hex");
    if (hex.length === 0) {
      return BigInt(0);
    }
    return BigInt(`0x${hex}`);
  }

  return converter.toBigInt(buf, true);
}

export function toBufferLE(num: bigint, width: number): Buffer {
  if (!converter) {
    const hex = num.toString(16);
    const buffer = Buffer.from(
      hex.padStart(width * 2, "0").slice(0, width * 2),
      "hex",
    );
    buffer.reverse();
    return buffer;
  }

  return converter.fromBigInt(num, Buffer.allocUnsafe(width), false);
}

export function toBufferBE(num: bigint, width: number): Buffer {
  if (!converter) {
    const hex = num.toString(16);
    return Buffer.from(
      hex.padStart(width * 2, "0").slice(0, width * 2),
      "hex",
    );
  }

  return converter.fromBigInt(num, Buffer.allocUnsafe(width), true);
}
