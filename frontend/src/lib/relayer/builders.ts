import "server-only";

import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import rawIdl from "@/idl/railpay.json";
import {
  BUBBLEGUM_PROGRAM_ID,
  PROGRAM_ID,
  SPL_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  USDC_USD_PYTH_ACCOUNT,
  deriveCircuitBreakerPda,
  deriveOfframpRequestPda,
  deriveProtocolConfigPda,
  deriveReferralConfigPda,
  deriveVaultPda,
  getTreeConfigPDA,
} from "@/lib/solana";
import { assertValidUpiId, hashUpiId } from "@/lib/upi";
import { loadRelayerKeypair, getRelayRpcUrl } from "@/lib/relayer/keypair";
import type { RelayAction } from "@/lib/relayer/types";

function withPatchedRelayIdl(source: Idl): Idl {
  type PatchedIdlArgType = "u64" | { array: ["u8", 32] };
  type PatchedIdlArg = {
    name: string;
    type: PatchedIdlArgType;
  };
  type PatchedIdlField = {
    name: string;
    type: "publicKey" | "u64" | "bool" | "u8";
  };

  const clone = JSON.parse(JSON.stringify(source)) as Idl & {
    instructions?: Array<{
      name: string;
      args?: PatchedIdlArg[];
    }>;
    accounts?: Array<{
      name: string;
      type?: {
        kind: "struct";
        fields: PatchedIdlField[];
      };
    }>;
  };

  for (const account of clone.accounts ?? []) {
    if (account.name === "ProtocolConfig") {
      account.type = {
        kind: "struct",
        fields: [
          { name: "admin", type: "publicKey" },
          { name: "relayerAuthority", type: "publicKey" },
          { name: "usdcMint", type: "publicKey" },
          { name: "merkleTree", type: "publicKey" },
          { name: "kycAuthority", type: "publicKey" },
          { name: "oracleMaxAge", type: "u64" },
          { name: "kaminoEnabled", type: "bool" },
          { name: "bump", type: "u8" },
        ],
      };
    }
  }

  for (const instruction of clone.instructions ?? []) {
    if (instruction.name === "initializeUser") {
      instruction.args = [
        {
          name: "upiHandleHash",
          type: { array: ["u8", 32] },
        },
      ];
    }

    if (instruction.name === "triggerOfframp") {
      instruction.args = [
        { name: "usdcAmount", type: "u64" },
        {
          name: "destinationUpiHash",
          type: { array: ["u8", 32] },
        },
        { name: "inrPaise", type: "u64" },
      ];
    }
  }

  return clone;
}

const idl = withPatchedRelayIdl(rawIdl as Idl);
const MIN_USDC_MICRO = BigInt(10_000);
const DEFAULT_COMPUTE_UNIT_LIMIT = 400_000;
const DEFAULT_PRIORITY_FEE_MICROLAMPORTS = 10_000;

interface ProtocolConfigAccountData {
  admin: PublicKey;
  usdcMint: PublicKey;
  merkleTree: PublicKey;
  kycAuthority: PublicKey;
  oracleMaxAge: BN;
  kaminoEnabled: boolean;
  bump: number;
}

interface UserVaultAccountData {
  receiptCount: number;
}

interface ReferralConfigAccountData {
  referrer: PublicKey;
  feeBps: number;
  totalEarnedUsdc: BN;
  totalReferred: BN;
  isActive: boolean;
  bump: number;
}

export interface PreparedRelayTransaction {
  transaction: Transaction;
  lastValidBlockHeight: number;
}

class ServerWallet {
  constructor(private readonly relayer = loadRelayerKeypair()) {}

  get publicKey(): PublicKey {
    return this.relayer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    if (transaction instanceof VersionedTransaction) {
      transaction.sign([this.relayer]);
      return transaction;
    }

    transaction.partialSign(this.relayer);
    return transaction;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    transactions.forEach((transaction) => {
      if (transaction instanceof VersionedTransaction) {
        transaction.sign([this.relayer]);
        return;
      }

      transaction.partialSign(this.relayer);
    });
    return transactions;
  }
}

let connectionSingleton: Connection | null = null;
let programSingleton: Program<Idl> | null = null;

function getRelayConnection(): Connection {
  if (!connectionSingleton) {
    connectionSingleton = new Connection(getRelayRpcUrl(), "confirmed");
  }
  return connectionSingleton;
}

function getRelayProgram(): Program<Idl> {
  if (!programSingleton) {
    const provider = new AnchorProvider(
      getRelayConnection(),
      new ServerWallet(),
      { commitment: "confirmed" },
    );
    programSingleton = new Program(idl, PROGRAM_ID, provider);
  }

  return programSingleton;
}

function parseUserPubkey(userPubkey: string): PublicKey {
  try {
    return new PublicKey(userPubkey);
  } catch {
    throw new Error("Invalid user wallet address.");
  }
}

function parseMicroUsdc(amountMicroUsdc: string): BN {
  if (!/^\d+$/.test(amountMicroUsdc)) {
    throw new Error("Amount must be an integer micro-USDC string.");
  }

  const parsedAmount = BigInt(amountMicroUsdc);
  if (parsedAmount < MIN_USDC_MICRO) {
    throw new Error("Amount must be at least 0.01 USDC.");
  }

  return new BN(amountMicroUsdc);
}

function parsePositiveU64(value: string, fieldName: string): BN {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${fieldName} must be an integer string.`);
  }

  const parsedValue = BigInt(value);
  if (parsedValue <= BigInt(0)) {
    throw new Error(`${fieldName} must be greater than zero.`);
  }

  return new BN(value);
}

function createComputeBudgetInstructions() {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({
      units: DEFAULT_COMPUTE_UNIT_LIMIT,
    }),
    // Devnet-safe fallback priority fee for relayed transactions. We can
    // swap this for a live fee estimate later without changing the flow.
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: DEFAULT_PRIORITY_FEE_MICROLAMPORTS,
    }),
  ];
}

export async function fetchProtocolConfigKeys(): Promise<ProtocolConfigAccountData> {
  const program = getRelayProgram();
  const [protocolConfigPda] = deriveProtocolConfigPda(PROGRAM_ID);
  return (await program.account.protocolConfig.fetch(
    protocolConfigPda,
  )) as unknown as ProtocolConfigAccountData;
}

async function fetchUserVault(vaultPda: PublicKey): Promise<UserVaultAccountData> {
  const program = getRelayProgram();
  return (await program.account.userVault.fetch(vaultPda)) as unknown as UserVaultAccountData;
}

async function assertAccountExists(
  connection: Connection,
  account: PublicKey,
  message: string,
): Promise<void> {
  const accountInfo = await connection.getAccountInfo(account, "confirmed");
  if (!accountInfo) {
    throw new Error(message);
  }
}

async function ensureAssociatedTokenAccountExists(
  connection: Connection,
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true);
  const existingAccount = await connection.getAccountInfo(ata, "confirmed");
  if (existingAccount) {
    return ata;
  }

  const relayer = loadRelayerKeypair();
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const createAtaTransaction = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer,
      ata,
      owner,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  );

  createAtaTransaction.feePayer = payer;
  createAtaTransaction.recentBlockhash = latestBlockhash.blockhash;
  createAtaTransaction.sign(relayer);

  try {
    const signature = await connection.sendRawTransaction(
      createAtaTransaction.serialize(),
      {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      },
    );

    await connection.confirmTransaction(
      {
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      "confirmed",
    );

    console.log(`[Relay] Initialized protocol ATA ${ata.toBase58()}`);
    return ata;
  } catch (error) {
    const accountInfoAfterFailure = await connection.getAccountInfo(ata, "confirmed");
    if (accountInfoAfterFailure) {
      return ata;
    }

    const message =
      error instanceof Error ? error.message : "Failed to initialize required token account.";
    throw new Error(message);
  }
}

export async function fetchReferralConfigByAddress(
  referralConfigPda: PublicKey,
): Promise<ReferralConfigAccountData> {
  const program = getRelayProgram();
  return (await program.account.referralConfig.fetch(
    referralConfigPda,
  )) as unknown as ReferralConfigAccountData;
}

async function buildActionTransaction(action: RelayAction): Promise<Transaction> {
  const program = getRelayProgram();
  const relayer = loadRelayerKeypair();
  const user = parseUserPubkey(action.userPubkey);
  const [vaultPda] = deriveVaultPda(user);

  switch (action.kind) {
    case "initialize_vault": {
      const upiHash = Array.from(await hashUpiId(action.upiId));
      return program.methods
        .initializeUser(upiHash)
        .accounts({
          feePayer: relayer.publicKey,
          user,
          userVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
    }

    case "deposit_usdc": {
      const protocolConfig = await fetchProtocolConfigKeys();
      const [protocolConfigPda] = deriveProtocolConfigPda(PROGRAM_ID);
      const amount = parseMicroUsdc(action.amountMicroUsdc);
      const userUsdcAccount = getAssociatedTokenAddressSync(protocolConfig.usdcMint, user);
      const vaultUsdcAccount = getAssociatedTokenAddressSync(
        protocolConfig.usdcMint,
        vaultPda,
        true,
      );

      return program.methods
        .receiveUsdc(amount, "RailFi vault funding")
        .accounts({
          feePayer: relayer.publicKey,
          user,
          protocolConfig: protocolConfigPda,
          userVault: vaultPda,
          userUsdcAccount,
          vaultUsdcAccount,
          usdcMint: protocolConfig.usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
    }

    case "trigger_offramp": {
      const connection = getRelayConnection();
      const protocolConfig = await fetchProtocolConfigKeys();
      const [protocolConfigPda] = deriveProtocolConfigPda(PROGRAM_ID);
      const [circuitBreakerPda] = deriveCircuitBreakerPda(PROGRAM_ID);
      assertValidUpiId(action.upiId);
      const destinationUpiHash = Array.from(await hashUpiId(action.upiId));
      const amount = parseMicroUsdc(action.amountMicroUsdc);
      const inrPaise = parsePositiveU64(action.inrPaise, "INR paise");
      const userVault = await fetchUserVault(vaultPda);
      const [offrampRequestPda] = deriveOfframpRequestPda(
        vaultPda,
        userVault.receiptCount,
        PROGRAM_ID,
      );
      const vaultUsdcAccount = getAssociatedTokenAddressSync(
        protocolConfig.usdcMint,
        vaultPda,
        true,
      );
      const protocolTreasuryAta = await ensureAssociatedTokenAccountExists(
        connection,
        relayer.publicKey,
        protocolConfigPda,
        protocolConfig.usdcMint,
      );
      const treeConfig = getTreeConfigPDA(protocolConfig.merkleTree);

      await assertAccountExists(
        connection,
        circuitBreakerPda,
        "Circuit breaker is not initialized on Devnet. Run the circuit-breaker init script before retrying.",
      );
      await assertAccountExists(
        connection,
        treeConfig,
        "Merkle tree config is missing or not delegated to RailFi. Re-run the Merkle tree setup before retrying.",
      );
      await assertAccountExists(
        connection,
        protocolTreasuryAta,
        "Protocol treasury token account is missing. Retry in a moment while RailFi initializes it.",
      );
      console.info("[Relay] Using Pyth USDC/USD account:", USDC_USD_PYTH_ACCOUNT.toBase58());
      const remainingAccounts: Array<{
        pubkey: PublicKey;
        isWritable: boolean;
        isSigner: boolean;
      }> = [];

      if (action.referralPubkey) {
        const referralPubkey = parseUserPubkey(action.referralPubkey);
        const [referralConfigPda] = deriveReferralConfigPda(referralPubkey, PROGRAM_ID);
        const referralConfig = await fetchReferralConfigByAddress(referralConfigPda);
        const referrerUsdcAta = getAssociatedTokenAddressSync(
          protocolConfig.usdcMint,
          referralConfig.referrer,
        );

        remainingAccounts.push(
          { pubkey: referralConfigPda, isWritable: true, isSigner: false },
          { pubkey: referrerUsdcAta, isWritable: true, isSigner: false },
        );
      }

      return program.methods
        .triggerOfframp(amount, destinationUpiHash, inrPaise)
        .accounts({
          feePayer: relayer.publicKey,
          kycAuthority: relayer.publicKey,
          user,
          protocolConfig: protocolConfigPda,
          circuitBreaker: circuitBreakerPda,
          usdcUsdPriceUpdate: USDC_USD_PYTH_ACCOUNT,
          userVault: vaultPda,
          offrampRequest: offrampRequestPda,
          vaultUsdcAccount,
          protocolTreasuryAta,
          usdcMint: protocolConfig.usdcMint,
          merkleTree: protocolConfig.merkleTree,
          treeConfig,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_COMPRESSION_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .transaction();
    }

    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`Unsupported relay action: ${String(exhaustiveCheck)}`);
    }
  }
}

export async function buildPreparedRelayTransaction(
  action: RelayAction,
): Promise<PreparedRelayTransaction> {
  const connection = getRelayConnection();
  const relayer = loadRelayerKeypair();
  const transaction = await buildActionTransaction(action);
  transaction.instructions = [
    ...createComputeBudgetInstructions(),
    ...transaction.instructions,
  ];
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");

  transaction.feePayer = relayer.publicKey;
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.partialSign(relayer);

  return {
    transaction,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  };
}
