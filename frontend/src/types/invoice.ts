export type InvoiceStatus = "OPEN" | "PAID" | "EXPIRED";

export interface InvoiceRecord {
  id: string;
  creatorWallet: string;
  amount: number;
  description: string;
  destinationUpiId: string;
  createdAt: number;
  expiresAt: number | null;
  status: InvoiceStatus;
  paidAt?: number | null;
  paidByWallet?: string | null;
  offrampTxSig?: string | null;
}

export type PublicInvoiceRecord = Omit<InvoiceRecord, "destinationUpiId">;

export interface CreateInvoiceInput {
  creatorWallet: string;
  amount: number;
  description: string;
  destinationUpiId: string;
  expiresAt: number | null;
}

export interface MarkInvoicePaidInput {
  paidByWallet: string;
  offrampTxSig: string;
}

export function toPublicInvoiceRecord(invoice: InvoiceRecord): PublicInvoiceRecord {
  const { destinationUpiId, ...publicInvoice } = invoice;
  void destinationUpiId;
  return publicInvoice;
}
