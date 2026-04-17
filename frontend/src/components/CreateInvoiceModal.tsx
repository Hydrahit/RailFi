"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Copy, Loader2, QrCode, X } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useToast } from "@/hooks/useToast";
import { validateUpi, isValidUpiFormat } from "@/features/offramp/utils/upi-validation";
import { useWalletSession } from "@/components/WalletSessionProvider";
import type { InvoiceRecord } from "@/types/invoice";

interface CreateInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (invoice: InvoiceRecord) => void;
}

function defaultExpiryIso(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

export function CreateInvoiceModal({ open, onClose, onCreated }: CreateInvoiceModalProps) {
  const { publicKey, signMessage } = useWallet();
  const { ensureSession } = useWalletSession();
  const { showToast } = useToast();
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [destinationUpiId, setDestinationUpiId] = useState("");
  const [upiStatus, setUpiStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [upiName, setUpiName] = useState("");
  const [expiryEnabled, setExpiryEnabled] = useState(true);
  const [expiryValue, setExpiryValue] = useState(defaultExpiryIso);
  const [createdInvoice, setCreatedInvoice] = useState<InvoiceRecord | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const invoiceUrl = useMemo(() => {
    if (!createdInvoice || typeof window === "undefined") {
      return "";
    }
    return `${window.location.origin}/pay/${createdInvoice.id}`;
  }, [createdInvoice]);

  useEffect(() => {
    if (!invoiceUrl) {
      setQrCodeUrl("");
      return;
    }

    let cancelled = false;
    void QRCode.toDataURL(invoiceUrl, {
      margin: 1,
      width: 220,
      color: { dark: "#111111", light: "#FFFFFF" },
    }).then((url) => {
      if (!cancelled) {
        setQrCodeUrl(url);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [invoiceUrl]);

  useEffect(() => {
    if (!open) {
      setAmount("");
      setDescription("");
      setDestinationUpiId("");
      setUpiStatus("idle");
      setUpiName("");
      setExpiryEnabled(true);
      setExpiryValue(defaultExpiryIso());
      setCreatedInvoice(null);
      setQrCodeUrl("");
      setIsSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!destinationUpiId) {
      setUpiStatus("idle");
      setUpiName("");
      return;
    }

    if (!isValidUpiFormat(destinationUpiId)) {
      setUpiStatus("invalid");
      setUpiName("");
      return;
    }

    setUpiStatus("checking");
    const timer = window.setTimeout(async () => {
      try {
        const result = await validateUpi(destinationUpiId);
        setUpiStatus(result.isValid ? "valid" : "invalid");
        setUpiName(result.isValid ? result.name ?? result.bank ?? "" : "");
      } catch {
        setUpiStatus("invalid");
        setUpiName("");
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [destinationUpiId]);

  if (!open) {
    return null;
  }

  async function handleCreateInvoice() {
    if (!publicKey || !signMessage || isSubmitting) {
      if (!signMessage) {
        showToast("This wallet does not support message signing.", "error");
      }
      return;
    }

    const amountValue = Number(amount);
    const expiresAt = expiryEnabled ? Math.floor(new Date(expiryValue).getTime() / 1000) : null;

    setIsSubmitting(true);
    try {
      await ensureSession();
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountValue,
          description: description.trim(),
          destinationUpiId,
          expiresAt,
        }),
      });
      const payload = (await response.json()) as InvoiceRecord | { error?: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Failed to create invoice.");
      }

      const invoice = payload as InvoiceRecord;
      setCreatedInvoice(invoice);
      onCreated(invoice);
      showToast("Invoice link generated", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to create invoice.", "error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopyLink() {
    if (!invoiceUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(invoiceUrl);
      showToast("Payment link copied", "success");
    } catch {
      showToast("Unable to copy payment link.", "error");
    }
  }

  const canSubmit =
    !!publicKey &&
    !!signMessage &&
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0 &&
    description.trim().length <= 120 &&
    upiStatus === "valid" &&
    (!expiryEnabled || (!!expiryValue && new Date(expiryValue).getTime() > Date.now()));

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="section-shell relative w-full max-w-xl rounded-3xl p-5 sm:p-6">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]"
        >
          <X className="h-4 w-4" />
        </button>

        {!createdInvoice ? (
          <div className="space-y-5">
            <div>
              <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                Invoice link
              </p>
              <h2 className="mt-2 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
                Generate a shareable payment request.
              </h2>
              <p className="mt-2 text-[13px] leading-6 text-[var(--text-2)]">
                Create a premium checkout link your client can open, connect, and settle in USDC.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                  Amount
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="rp-input pr-16"
                    placeholder="0.00"
                    disabled={isSubmitting}
                  />
                  <span className="absolute right-5 top-1/2 -translate-y-1/2 text-[12px] font-[var(--font-mono)] text-[var(--text-3)]">
                    USDC
                  </span>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={120}
                  rows={3}
                  className="rp-input min-h-[110px] resize-none"
                  placeholder="April design retainer"
                  disabled={isSubmitting}
                />
                <p className="mt-2 text-right text-[11px] text-[var(--text-3)]">
                  {description.trim().length}/120
                </p>
              </div>

              <div>
                <label className="mb-2 block text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                  Your settlement UPI ID
                </label>
                <input
                  type="text"
                  value={destinationUpiId}
                  onChange={(event) => setDestinationUpiId(event.target.value.toLowerCase())}
                  className="rp-input"
                  placeholder="yourname@upi"
                  disabled={isSubmitting}
                  autoComplete="off"
                  spellCheck={false}
                />
                {upiName && upiStatus === "valid" ? (
                  <p className="mt-2 text-[12px] text-[var(--green-strong)]">Verified destination: {upiName}</p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-black/10 bg-[var(--surface-muted)] px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                      Auto-expiry
                    </p>
                    <p className="mt-1 text-[13px] text-[var(--text-2)]">
                      Expired invoices are blocked automatically on both API and checkout.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpiryEnabled((current) => !current)}
                    className={`inline-flex rounded-full px-3 py-1.5 text-[11px] font-[var(--font-mono)] ${
                      expiryEnabled
                        ? "bg-[var(--surface-heavy)] text-[var(--text-heavy-primary)]"
                        : "bg-[var(--bg-card)] text-[var(--text-2)]"
                    }`}
                    disabled={isSubmitting}
                  >
                    {expiryEnabled ? "Enabled" : "Disabled"}
                  </button>
                </div>

                {expiryEnabled ? (
                  <input
                    type="datetime-local"
                    value={expiryValue}
                    onChange={(event) => setExpiryValue(event.target.value)}
                    className="rp-input mt-4"
                    disabled={isSubmitting}
                  />
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} className="btn-ghost rounded-lg" disabled={isSubmitting}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateInvoice()}
                className="btn-primary btn-accent rounded-lg"
                disabled={!canSubmit || isSubmitting}
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                {isSubmitting ? "Generating link..." : "Create invoice"}
              </button>
            </div>
            {!signMessage && publicKey ? (
              <p className="text-[12px] text-[var(--warning-fg)]">
                This wallet must support message signing to create invoices.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                Invoice ready
              </p>
              <h2 className="mt-2 font-[var(--font-syne)] text-3xl font-[800] tracking-[-0.05em] text-[var(--text-1)]">
                Share this payment link.
              </h2>
              <p className="mt-2 text-[13px] leading-6 text-[var(--text-2)]">
                Your client can scan the QR code or open the direct `/pay` link to settle in USDC.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
              <div className="surface-card flex items-center justify-center rounded-2xl p-4">
                {qrCodeUrl ? (
                  <Image
                    src={qrCodeUrl}
                    alt="Invoice QR code"
                    width={220}
                    height={220}
                    unoptimized
                    className="h-[220px] w-[220px] rounded-xl"
                  />
                ) : (
                  <div className="skeleton h-[220px] w-[220px] rounded-xl" />
                )}
              </div>

              <div className="space-y-3">
                <div className="surface-card rounded-2xl p-4">
                  <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                    Link
                  </p>
                  <p className="mt-2 break-all text-[13px] text-[var(--text-2)]">{invoiceUrl}</p>
                  <button type="button" onClick={() => void handleCopyLink()} className="btn-ghost mt-4 rounded-lg">
                    <Copy className="h-4 w-4" />
                    Copy link
                  </button>
                </div>

                <div className="surface-card rounded-2xl p-4">
                  <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.22em] text-[var(--text-3)]">
                    Summary
                  </p>
                  <p className="mt-2 font-[var(--font-syne)] text-2xl font-[800] tracking-[-0.04em] text-[var(--text-1)]">
                    {createdInvoice.amount.toFixed(2)} USDC
                  </p>
                  <p className="mt-2 text-[13px] text-[var(--text-2)]">
                    {createdInvoice.description || "No description provided."}
                  </p>
                  <p className="mt-2 text-[12px] text-[var(--text-3)]">
                    Routed to {createdInvoice.destinationUpiId}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="btn-primary btn-accent rounded-lg">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
