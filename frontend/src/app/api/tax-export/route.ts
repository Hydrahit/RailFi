import { NextRequest, NextResponse } from "next/server";
import { PROGRAM_ID } from "@/lib/solana";
import { applyPythExponent, fetchOfframpHistory } from "@/lib/offramp-reader";
import { enforceWalletRateLimit } from "@/lib/rate-limit";
import {
  attachWalletSessionCookie,
  getRefreshedWalletSessionFromRequest,
} from "@/lib/wallet-session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseFinancialYear(fy: string): { fyLabel: string; fyStart: number; fyEnd: number } | null {
  const match = fy.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (!Number.isInteger(startYear) || endYear !== (startYear + 1) % 100) {
    return null;
  }

  const istOffsetSeconds = 5.5 * 60 * 60;

  return {
    fyLabel: fy,
    fyStart: Date.UTC(startYear, 3, 1, 0, 0, 0) / 1000 - istOffsetSeconds,
    fyEnd: Date.UTC(startYear + 1, 3, 1, 0, 0, 0) / 1000 - istOffsetSeconds - 1,
  };
}

function getFormatters() {
  return {
    date: new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
    time: new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
    inr: new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  };
}

function escapeCsv(value: string | number): string {
  const stringValue = String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getRefreshedWalletSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const walletLimit = await enforceWalletRateLimit(
    session.walletAddress,
    "taxExportWallet",
    "Tax export rate limit exceeded for this wallet.",
  );
  if (!walletLimit.allowed) {
    return NextResponse.json({ error: walletLimit.message }, { status: 429 });
  }

  const wallet = session.walletAddress;
  const fy = request.nextUrl.searchParams.get("fy")?.trim() ?? "";

  const fyBounds = parseFinancialYear(fy);
  if (!fyBounds) {
    return NextResponse.json({ error: "Invalid financial year." }, { status: 400 });
  }

  let records;
  try {
    records = await fetchOfframpHistory(wallet, fyBounds.fyStart, fyBounds.fyEnd);
  } catch (error) {
    console.error("[tax-export] fetch failed:", error);
    return NextResponse.json({ error: "Failed to read on-chain offramp history." }, { status: 502 });
  }

  if (records.length === 0) {
    const response = new NextResponse(null, { status: 204 });
    return attachWalletSessionCookie(response, session.sessionId);
  }

  const formatters = getFormatters();
  const headers = [
    "Date (IST)",
    "Time (IST)",
    "USDC Amount",
    "USDC/USD Rate (Pyth Locked)",
    "USD/INR Rate",
    "INR Value",
    "Transaction Type",
    "FEMA Purpose Code",
    "Solana Tx Signature",
    "Notes",
  ];

  const rows = records.map((record) => {
    const timestampDate = new Date(record.blockTime * 1000);
    const usdcAmount = record.usdcAmountLamports / 1_000_000;
    const usdcUsdRate = applyPythExponent(record.lockedUsdcUsdPrice, record.priceExpo);
    const inrValue = record.inrPaise > 0 ? record.inrPaise / 100 : null;
    const usdInrRate =
      inrValue !== null && usdcAmount > 0 && usdcUsdRate > 0
        ? inrValue / (usdcAmount * usdcUsdRate)
        : null;
    const notes =
      record.inrPaise > 0
        ? ""
        : "Legacy pre-INR-lock record - INR quote was not stored on-chain.";

    return [
      formatters.date.format(timestampDate),
      formatters.time.format(timestampDate),
      usdcAmount.toFixed(6),
      usdcUsdRate.toFixed(6),
      usdInrRate !== null ? usdInrRate.toFixed(4) : "",
      inrValue !== null ? formatters.inr.format(inrValue) : "",
      "USDC-to-INR Conversion (VDA)",
      "P0802",
      record.signature,
      notes,
    ]
      .map(escapeCsv)
      .join(",");
  });

  const totalUsdc = records.reduce((sum, record) => sum + record.usdcAmountLamports / 1_000_000, 0);
  const totalInr = records.reduce((sum, record) => sum + record.inrPaise / 100, 0);
  const csv = [
    headers.map(escapeCsv).join(","),
    ...rows,
    "",
    `${escapeCsv("Financial Year")},${escapeCsv(fyBounds.fyLabel)}`,
    `${escapeCsv("Wallet")},${escapeCsv(wallet)}`,
    `${escapeCsv("Program ID")},${escapeCsv(PROGRAM_ID.toBase58())}`,
    `${escapeCsv("Transaction Count")},${escapeCsv(records.length)}`,
    `${escapeCsv("Total USDC")},${escapeCsv(totalUsdc.toFixed(6))}`,
    `${escapeCsv("Total INR")},${escapeCsv(totalInr.toFixed(2))}`,
    `${escapeCsv("Generated At")},${escapeCsv(new Date().toISOString())}`,
  ].join("\r\n");

  const response = new NextResponse(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="railfi-tax-${fyBounds.fyLabel}-${wallet.slice(0, 8)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
  return attachWalletSessionCookie(response, session.sessionId);
}
