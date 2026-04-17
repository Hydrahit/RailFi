"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BN, type Idl, type Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  type Connection,
  type SendOptions as SendTransactionOptions,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { hashUpiId } from "@/lib/upi";
import { calculateOfframpChargeBreakdown } from "@/lib/referrals";
import { isValidUpiFormat } from "@/features/offramp/utils/upi-validation";
import { explorerTx } from "@/lib/solana";
import { formatProgramError, isUserRejection, logSendTransactionError, TransactionConfirmationTimeoutError } from "@/lib/railpay/errors";
import {
  confirmSubmittedTransaction,
  submitTransactionDirect,
  submitTransactionViaRelay,
  submitWithPreferredPath,
  type SubmittedTransaction,
} from "@/lib/railpay/transactions";
import type { FundingPhase, OfframpPhase, VaultDisplay } from "@/types/railpay";
import type { ProtocolConfigKeys } from "@/lib/railpay/protocol";

export interface RailpayTxResult {
  signature: string;
  explorerUrl: string;
  receiptId?: number;
}

export interface TriggerOfframpReferralInput {
  referrer: string;
  feeBps: number;
}

const MIN_USDC_AMOUNT = 0.01;
const MIN_USDC_MICRO = 10_000;
const DEPOSIT_NOTE = "RailFi vault funding";
const TRANSACTION_CONFIRM_TIMEOUT_MS = 75_000;

interface InitializeUserAccounts extends Record<string, PublicKey> {
  feePayer: PublicKey;
  user: PublicKey;
  userVault: PublicKey;
  systemProgram: PublicKey;
}

interface ReceiveUsdcAccounts extends Record<string, PublicKey> {
  feePayer: PublicKey;
  user: PublicKey;
  protocolConfig: PublicKey;
  userVault: PublicKey;
  userUsdcAccount: PublicKey;
  vaultUsdcAccount: PublicKey;
  usdcMint: PublicKey;
  tokenProgram: PublicKey;
  associatedTokenProgram: PublicKey;
  systemProgram: PublicKey;
}

function parseUsdcAmount(amountUsdc: number, decimals: number): BN | null {
  if (!Number.isFinite(amountUsdc) || amountUsdc < MIN_USDC_AMOUNT) {
    return null;
  }

  const microUsdc = Math.round(amountUsdc * 10 ** decimals);
  if (!Number.isSafeInteger(microUsdc) || microUsdc < MIN_USDC_MICRO) {
    return null;
  }

  return new BN(microUsdc);
}

interface UseRailpayActionsParams {
  connection: Connection;
  publicKey: PublicKey | null;
  signTransaction?: ((transaction: Transaction) => Promise<Transaction>) | undefined;
  sendTransaction?: ((
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options?: SendTransactionOptions,
  ) => Promise<string>) | undefined;
  getProgram: () => Program<Idl> | null;
  protocolConfigPda: PublicKey;
  protocolConfigKeys: ProtocolConfigKeys | null;
  vaultPda: PublicKey | null;
  vault: VaultDisplay | null;
  refreshBalances: () => Promise<void>;
  refreshVault: () => Promise<void>;
  refreshProtocolConfig: () => Promise<void>;
  usdcDecimals: number;
}

export function useRailpayActions({
  connection,
  publicKey,
  signTransaction,
  sendTransaction,
  getProgram,
  protocolConfigPda,
  protocolConfigKeys,
  vaultPda,
  vault,
  refreshBalances,
  refreshVault,
  refreshProtocolConfig,
  usdcDecimals,
}: UseRailpayActionsParams) {
  const [txPhase, setTxPhase] = useState<OfframpPhase>("idle");
  const [txResult, setTxResult] = useState<RailpayTxResult | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [depositPhase, setDepositPhase] = useState<FundingPhase>("idle");
  const [depositResult, setDepositResult] = useState<RailpayTxResult | null>(null);
  const [depositError, setDepositError] = useState<string | null>(null);
  const txInFlightRef = useRef(false);
  const depositInFlightRef = useRef(false);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const resetTx = useCallback(() => {
    setTxPhase("idle");
    setTxResult(null);
    setTxError(null);
  }, []);

  const resetDeposit = useCallback(() => {
    setDepositPhase("idle");
    setDepositResult(null);
    setDepositError(null);
  }, []);

  const submitDirect = useCallback(
    async (transaction: Transaction): Promise<SubmittedTransaction> =>
      submitTransactionDirect({
        connection,
        publicKey,
        sendTransaction,
        transaction,
      }),
    [connection, publicKey, sendTransaction],
  );

  const confirmSubmitted = useCallback(
    async (submitted: SubmittedTransaction) =>
      confirmSubmittedTransaction({
        connection,
        ...submitted,
        timeoutMs: TRANSACTION_CONFIRM_TIMEOUT_MS,
      }),
    [connection],
  );

  const initializeVault = useCallback(
    async (upiId: string) => {
      const normalizedUpiId = upiId.trim().toLowerCase();

      if (txInFlightRef.current) {
        return;
      }

      if (!publicKey || !vaultPda) {
        setTxError("Wallet not connected.");
        return;
      }

      if (!isValidUpiFormat(normalizedUpiId)) {
        setTxError("Enter a valid UPI ID.");
        return;
      }

      resetTx();
      setTxPhase("awaiting_signature");
      txInFlightRef.current = true;

      try {
        const submittedTransaction = await submitWithPreferredPath({
          signTransaction,
          action: {
            kind: "initialize_vault",
            userPubkey: publicKey.toBase58(),
            upiId: normalizedUpiId,
          },
          submitDirect: async () => {
            const program = getProgram();
            if (!program) {
              throw new Error("Wallet not ready for direct submission.");
            }

            const accounts: InitializeUserAccounts = {
              feePayer: publicKey,
              user: publicKey,
              userVault: vaultPda,
              systemProgram: SystemProgram.programId,
            };

            const transaction = await program.methods
              .initializeUser(Array.from(await hashUpiId(normalizedUpiId)))
              .accounts(accounts)
              .transaction();

            return submitDirect(transaction);
          },
        });

        if (!isMountedRef.current) return;
        setTxPhase("confirming");
        await confirmSubmitted(submittedTransaction);
        if (!isMountedRef.current) return;
        setTxPhase("settling");
        await Promise.all([refreshProtocolConfig(), refreshBalances(), refreshVault()]);
        if (!isMountedRef.current) return;
        setTxPhase("done");
        setTxResult({
          signature: submittedTransaction.signature,
          explorerUrl: explorerTx(submittedTransaction.signature),
        });
      } catch (error: unknown) {
        if (!isMountedRef.current) return;
        if (isUserRejection(error)) {
          setTxPhase("idle");
          setTxError(null);
        } else {
          if (error instanceof TransactionConfirmationTimeoutError) {
            setTxResult({
              signature: error.signature,
              explorerUrl: explorerTx(error.signature),
            });
          }
          setTxPhase("error");
          setTxError(formatProgramError(error, "Failed to initialize vault."));
        }
      } finally {
        txInFlightRef.current = false;
      }
    },
    [confirmSubmitted, getProgram, publicKey, refreshBalances, refreshProtocolConfig, refreshVault, resetTx, signTransaction, submitDirect, vaultPda],
  );

  const depositUsdc = useCallback(
    async (amountUsdc: number) => {
      if (depositInFlightRef.current) {
        return;
      }

      if (!publicKey || !vaultPda) {
        setDepositError("Wallet not connected.");
        return;
      }

      if (!vault) {
        setDepositError("Initialize your vault before depositing.");
        return;
      }

      if (!protocolConfigKeys) {
        setDepositError("Protocol config is not initialized yet.");
        return;
      }

      const amountMicroUsdc = parseUsdcAmount(amountUsdc, usdcDecimals);
      if (!amountMicroUsdc) {
        setDepositError("Deposit at least 0.01 USDC.");
        return;
      }

      resetDeposit();
      setDepositPhase("awaiting_signature");
      depositInFlightRef.current = true;

      try {
        const submittedTransaction = await submitWithPreferredPath({
          signTransaction,
          action: {
            kind: "deposit_usdc",
            userPubkey: publicKey.toBase58(),
            amountMicroUsdc: amountMicroUsdc.toString(),
          },
          submitDirect: async () => {
            const program = getProgram();
            if (!program) {
              throw new Error("Wallet not ready for direct submission.");
            }

            const userUsdcAccount = await getAssociatedTokenAddress(
              protocolConfigKeys.usdcMint,
              publicKey,
            );
            const vaultUsdcAccount = await getAssociatedTokenAddress(
              protocolConfigKeys.usdcMint,
              vaultPda,
              true,
            );

            const accounts: ReceiveUsdcAccounts = {
              feePayer: publicKey,
              user: publicKey,
              protocolConfig: protocolConfigPda,
              userVault: vaultPda,
              userUsdcAccount,
              vaultUsdcAccount,
              usdcMint: protocolConfigKeys.usdcMint,
              tokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            };

            const transaction = await program.methods
              .receiveUsdc(amountMicroUsdc, DEPOSIT_NOTE)
              .accounts(accounts)
              .transaction();

            return submitDirect(transaction);
          },
        });

        if (!isMountedRef.current) return;
        setDepositPhase("confirming");
        await confirmSubmitted(submittedTransaction);
        if (!isMountedRef.current) return;
        await Promise.all([refreshBalances(), refreshVault()]);
        if (!isMountedRef.current) return;
        setDepositPhase("done");
        setDepositResult({
          signature: submittedTransaction.signature,
          explorerUrl: explorerTx(submittedTransaction.signature),
        });
      } catch (error: unknown) {
        if (!isMountedRef.current) return;
        if (isUserRejection(error)) {
          setDepositPhase("idle");
          setDepositError(null);
        } else {
          if (error instanceof TransactionConfirmationTimeoutError) {
            setDepositResult({
              signature: error.signature,
              explorerUrl: explorerTx(error.signature),
            });
          }
          setDepositPhase("error");
          setDepositError(formatProgramError(error, "Failed to deposit USDC."));
        }
      } finally {
        depositInFlightRef.current = false;
      }
    },
    [confirmSubmitted, getProgram, protocolConfigKeys, protocolConfigPda, publicKey, refreshBalances, refreshVault, resetDeposit, signTransaction, submitDirect, usdcDecimals, vault, vaultPda],
  );

  const triggerOfframp = useCallback(
    async (
      amountUsdc: number,
      upiId: string,
      inrPaise: number,
      referral?: TriggerOfframpReferralInput | null,
    ) => {
      const normalizedUpiId = upiId.trim().toLowerCase();

      if (txInFlightRef.current) {
        return;
      }

      if (!publicKey || !vaultPda) {
        setTxError("Wallet not connected.");
        return;
      }

      if (!vault) {
        setTxError("Initialize and fund your vault first.");
        return;
      }

      if (!protocolConfigKeys) {
        setTxError("Protocol config is not initialized yet.");
        return;
      }

      if (!isValidUpiFormat(normalizedUpiId)) {
        setTxError("Enter a valid UPI ID.");
        return;
      }

      const amountMicroUsdc = parseUsdcAmount(amountUsdc, usdcDecimals);
      if (!amountMicroUsdc) {
        setTxError("Enter an amount of at least 0.01 USDC.");
        return;
      }

      if (referral?.referrer) {
        try {
          new PublicKey(referral.referrer);
        } catch {
          setTxError("Referral link is invalid. Remove the referral and try again.");
          return;
        }
      }

      if (!Number.isSafeInteger(inrPaise) || inrPaise <= 0) {
        setTxError("Quote unavailable. Wait for a valid INR estimate before submitting.");
        return;
      }

      const inrPaiseBn = new BN(inrPaise);
      const chargeBreakdown = calculateOfframpChargeBreakdown(
        amountUsdc,
        referral?.feeBps ?? null,
      );

      if (chargeBreakdown.totalDeductedUsdc > vault.availableUsdc) {
        setTxError("Deposit more USDC into your vault to cover the payout and fees.");
        return;
      }

      resetTx();
      setTxPhase("awaiting_signature");
      txInFlightRef.current = true;

      try {
        const expectedReceiptId = vault.receiptCount;
        const submittedTransaction = await submitTransactionViaRelay({
          signTransaction,
          action: {
            kind: "trigger_offramp",
            userPubkey: publicKey.toBase58(),
            amountMicroUsdc: amountMicroUsdc.toString(),
            upiId: normalizedUpiId,
            inrPaise: inrPaiseBn.toString(),
            referralPubkey: referral?.referrer ?? null,
          },
        });

        if (!isMountedRef.current) return;
        setTxPhase("confirming");
        await confirmSubmitted(submittedTransaction);
        if (!isMountedRef.current) return;
        setTxPhase("settling");
        await Promise.all([refreshBalances(), refreshVault()]);
        if (!isMountedRef.current) return;
        setTxPhase("done");
        setTxResult({
          signature: submittedTransaction.signature,
          explorerUrl: explorerTx(submittedTransaction.signature),
          receiptId: expectedReceiptId,
        });
      } catch (error: unknown) {
        if (!isMountedRef.current) return;
        await logSendTransactionError(connection, error);
        if (isUserRejection(error)) {
          setTxPhase("idle");
          setTxError(null);
        } else {
          if (error instanceof TransactionConfirmationTimeoutError) {
            setTxResult({
              signature: error.signature,
              explorerUrl: explorerTx(error.signature),
              receiptId: vault?.receiptCount,
            });
          }
          setTxPhase("error");
          setTxError(formatProgramError(error, "Failed to trigger offramp."));
        }
      } finally {
        txInFlightRef.current = false;
      }
    },
    [confirmSubmitted, connection, protocolConfigKeys, publicKey, refreshBalances, refreshVault, resetTx, signTransaction, usdcDecimals, vault, vaultPda],
  );

  return {
    txPhase,
    txResult,
    txError,
    depositPhase,
    depositResult,
    depositError,
    initializeVault,
    depositUsdc,
    triggerOfframp,
    resetTx,
    resetDeposit,
  };
}
