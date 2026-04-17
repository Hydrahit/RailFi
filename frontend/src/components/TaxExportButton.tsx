"use client";

import { useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useToast } from "@/hooks/useToast";

function getCurrentFinancialYearStartYear(): number {
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const year = istNow.getUTCFullYear();
  const month = istNow.getUTCMonth();
  return month >= 3 ? year : year - 1;
}

function formatFinancialYear(startYear: number): string {
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function toFinancialYearParam(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function parseFilename(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }

  const match = headerValue.match(/filename="([^"]+)"/i);
  return match?.[1] ?? null;
}

export function TaxExportButton() {
  const { publicKey } = useWallet();
  const { showToast } = useToast();
  const [selectedFy, setSelectedFy] = useState(() =>
    toFinancialYearParam(getCurrentFinancialYearStartYear()),
  );
  const [isDownloading, setIsDownloading] = useState(false);

  const options = useMemo(() => {
    const currentStartYear = getCurrentFinancialYearStartYear();
    return Array.from({ length: 4 }, (_, index) => {
      const startYear = currentStartYear - index;
      return {
        label: formatFinancialYear(startYear),
        value: toFinancialYearParam(startYear),
      };
    });
  }, []);
  const selectedFyLabel = options.find((option) => option.value === selectedFy)?.label ?? selectedFy;

  if (!publicKey) {
    return null;
  }

  const handleDownload = async () => {
    if (isDownloading) {
      return;
    }

    setIsDownloading(true);

    try {
      const response = await fetch(
        `/api/tax-export?wallet=${encodeURIComponent(publicKey.toBase58())}&fy=${encodeURIComponent(selectedFy)}`,
      );

      if (response.status === 204) {
        showToast(`No offramp ledger entries found for ${selectedFyLabel}`, "success");
        return;
      }

      if (!response.ok) {
        let errorMessage = "Tax export failed.";

        try {
          const payload = (await response.json()) as { error?: string };
          if (payload.error) {
            errorMessage = payload.error;
          }
        } catch (error) {
          console.error("[TaxExport] Error body parse failed:", error);
        }

        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download =
        parseFilename(response.headers.get("content-disposition")) ?? `railfi-tax-${selectedFy}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
      showToast(`Tax report downloaded for ${selectedFyLabel}`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tax export failed.";
      showToast(message, "error");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.2em] text-[var(--text-3)]">
          Tax export
        </p>
        <p className="mt-1 text-[12px] text-[var(--text-2)]">
          Source: Solana blockchain via Helius - independently verifiable on-chain.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="action-pill min-w-[136px] justify-between gap-3">
          <span className="text-[11px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[var(--text-3)]">
            FY
          </span>
          <select
            value={selectedFy}
            onChange={(event) => setSelectedFy(event.target.value)}
            disabled={isDownloading}
            className="min-w-0 bg-transparent pr-1 text-[12px] font-[var(--font-syne)] font-[700] text-[var(--text-1)] outline-none"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={isDownloading}
          className="action-pill justify-center disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {isDownloading ? "Preparing CSV..." : "Download tax report"}
        </button>
      </div>
    </div>
  );
}
