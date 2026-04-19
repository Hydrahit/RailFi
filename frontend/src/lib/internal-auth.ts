import { Receiver } from "@upstash/qstash";
import { NextRequest, NextResponse } from "next/server";

let qstashReceiver: Receiver | null = null;

function getReceiver(): Receiver {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY?.trim();

  if (!currentSigningKey || !nextSigningKey) {
    throw new Error("QStash signing keys are not configured.");
  }

  qstashReceiver ??= new Receiver({
    currentSigningKey,
    nextSigningKey,
  });

  return qstashReceiver;
}

export async function requireInternalAuth(
  req: NextRequest,
  rawBody: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const internalSecret = process.env.INTERNAL_WORKER_SECRET?.trim();
  const providedSecret = req.headers.get("x-internal-secret")?.trim();
  if (internalSecret && providedSecret === internalSecret) {
    return { ok: true };
  }

  const qstashSignature = req.headers.get("upstash-signature")?.trim();
  if (qstashSignature) {
    if (!process.env.QSTASH_CURRENT_SIGNING_KEY?.trim()) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "QStash signing key is not configured." },
          { status: 503 },
        ),
      };
    }

    try {
      const isValid = await getReceiver().verify({
        signature: qstashSignature,
        body: rawBody,
        url: req.url,
      });

      if (isValid) {
        return { ok: true };
      }
    } catch {
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }
  }

  return {
    ok: false,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
}
