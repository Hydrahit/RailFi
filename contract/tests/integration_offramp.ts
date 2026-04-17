// RailPay Integration Test Suite
// Runs against Solana Devnet — requires funded wallet and deployed program
// Program ID: A7nQnuCfrtBwTdGwgAptFWVE6g2n1b7GGTanc8aToEUt
// Run with: anchor test --provider.cluster devnet
// Prerequisites: wallet must have Devnet SOL and Devnet USDC

import * as anchor from "@coral-xyz/anchor";
import { Program, BN, BorshCoder, EventParser, type Idl } from "@coral-xyz/anchor";
import { assert } from "chai";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  getAccount,
  getAssociatedTokenAddressSync,
  transfer as splTransfer,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

type ProtocolConfigAccount = {
  admin: PublicKey;
  usdcMint: PublicKey;
  merkleTree: PublicKey;
  kycAuthority: PublicKey;
  oracleMaxAge: BN;
  kaminoEnabled: boolean;
  bump: number;
};

type CircuitBreakerAccount = {
  authority: PublicKey;
  maxOutflowPerWindow: BN;
  windowDurationSeconds: BN;
  windowStart: BN;
  outflowThisWindow: BN;
  isTripped: boolean;
  tripCount: BN;
  bump: number;
};

type UserVaultAccount = {
  owner: PublicKey;
  totalReceived: BN;
  totalOfframped: BN;
  receiptCount: number;
  isActive: boolean;
  bump: number;
};

type OfframpRequestAccount = {
  user: PublicKey;
  vault: PublicKey;
  usdcAmount: BN;
  inrPaise: BN;
  receiptId: number;
  destinationUpiHash: number[];
  timestamp: BN;
  lockedUsdcUsdPrice: BN;
  priceExpo: number;
  priceLockedAt: BN;
  priceConf: BN;
  bump: number;
};

type ParsedOfframpEvent = {
  user: PublicKey;
  vault: PublicKey;
  usdcAmount: BN;
  inrPaise: BN;
  receiptId: number;
  destinationUpiHash: number[];
  timestamp: BN;
};

const PROGRAM_ID = new PublicKey("A7nQnuCfrtBwTdGwgAptFWVE6g2n1b7GGTanc8aToEUt");
const BUBBLEGUM_PROGRAM_ID = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
const SPL_COMPRESSION_PROGRAM_ID = new PublicKey(
  "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK",
);
const SPL_NOOP_PROGRAM_ID = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");
const USDC_USD_PRICE_UPDATE = new PublicKey("EF6U755BdHMXim8RBw6XSC6Yk6XaouTKpwcBZ7QkcanB");
const TEST_USDC_AMOUNT = 1_000_000;
const TEST_UPI = "test@upi";

function hashUpiId(upiId: string): number[] {
  return Array.from(
    createHash("sha256").update(upiId.trim().toLowerCase(), "utf8").digest(),
  );
}

type HeliusAssetResponse = {
  result?: {
    items?: Array<{
      id: string;
      compression?: { compressed?: boolean };
      content?: {
        json_uri?: string;
        metadata?: {
          name?: string;
          symbol?: string;
        };
      };
    }>;
  };
};

type HeliusAsset = NonNullable<NonNullable<HeliusAssetResponse["result"]>["items"]>[number];

function isDevnetProvider(provider: anchor.AnchorProvider): boolean {
  return provider.connection.rpcEndpoint.toLowerCase().includes("devnet");
}

function deriveProtocolConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("protocol_config")], programId)[0];
}

function deriveCircuitBreakerPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("circuit_breaker")], programId)[0];
}

function deriveUserVaultPda(programId: PublicKey, user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_vault"), user.toBuffer()],
    programId,
  )[0];
}

function deriveOfframpRequestPda(
  programId: PublicKey,
  vault: PublicKey,
  receiptCount: number,
): PublicKey {
  const receiptSeed = Buffer.alloc(4);
  receiptSeed.writeUInt32LE(receiptCount, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("offramp_request"), vault.toBuffer(), receiptSeed],
    programId,
  )[0];
}

function readEnvValueFromFrontend(key: string): string | null {
  if (process.env[key]) {
    return process.env[key] ?? null;
  }

  for (const candidate of [
    path.resolve(__dirname, "../../frontend/.env.local"),
    path.resolve(__dirname, "../../frontend/.env"),
  ]) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const lines = fs.readFileSync(candidate, "utf8").split(/\r?\n/);
    for (const line of lines) {
      if (!line || line.trimStart().startsWith("#")) {
        continue;
      }

      const separator = line.indexOf("=");
      if (separator <= 0) {
        continue;
      }

      const envKey = line.slice(0, separator).trim();
      if (envKey !== key) {
        continue;
      }

      return line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  }

  return null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureTestUserSol(
  provider: anchor.AnchorProvider,
  recipient: PublicKey,
): Promise<void> {
  const currentBalance = await provider.connection.getBalance(recipient, "confirmed");
  if (currentBalance >= 0.05 * LAMPORTS_PER_SOL) {
    return;
  }

  const payer = (provider.wallet as anchor.Wallet & { payer?: Keypair }).payer;
  if (!payer) {
    throw new Error("Provider wallet does not expose a payer keypair for test funding");
  }

  const signature = await provider.sendAndConfirm(
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: recipient,
        lamports: 0.1 * LAMPORTS_PER_SOL,
      }),
    ),
    [payer],
    { commitment: "confirmed" },
  );

  console.log(`Funded test user with SOL: ${signature}`);
}

describe("RailPay Integration — Full Offramp Flow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.RailpayContract as Program<any>;

  const runOnDevnet = isDevnetProvider(provider);
  const maybeIt = runOnDevnet ? it : it.skip;

  const admin = provider.wallet.publicKey;
  const protocolConfigPda = deriveProtocolConfigPda(PROGRAM_ID);
  const circuitBreakerPda = deriveCircuitBreakerPda(PROGRAM_ID);
  const testUser = Keypair.generate();
  const userVaultPda = deriveUserVaultPda(PROGRAM_ID, testUser.publicKey);
  const wrongPriceFeed = Keypair.generate().publicKey;

  let protocolConfig: ProtocolConfigAccount;
  let treeConfigPda: PublicKey;
  let userUsdcAccount: PublicKey;
  let adminUsdcAccount: PublicKey;
  let vaultUsdcAccount: PublicKey;
  let protocolTreasuryAta: PublicKey;
  let originalCircuitBreakerMax = new BN(10_000_000_000);
  let hasUsdcFunding = false;
  let depositCompleted = false;
  let happyPathOfframpRequestPda: PublicKey | null = null;
  let happyPathReceiptId: number | null = null;

  before(async function () {
    if (!runOnDevnet) {
      this.skip();
    }

    protocolConfig = (await program.account.protocolConfig.fetch(
      protocolConfigPda,
    )) as ProtocolConfigAccount;

    treeConfigPda = PublicKey.findProgramAddressSync(
      [protocolConfig.merkleTree.toBuffer()],
      BUBBLEGUM_PROGRAM_ID,
    )[0];

    userUsdcAccount = getAssociatedTokenAddressSync(
      protocolConfig.usdcMint,
      testUser.publicKey,
      false,
    );
    adminUsdcAccount = getAssociatedTokenAddressSync(protocolConfig.usdcMint, admin, false);
    vaultUsdcAccount = getAssociatedTokenAddressSync(protocolConfig.usdcMint, userVaultPda, true);
    protocolTreasuryAta = getAssociatedTokenAddressSync(
      protocolConfig.usdcMint,
      protocolConfigPda,
      true,
    );

    await ensureTestUserSol(provider, testUser.publicKey);
  });

  maybeIt("TEST 1: Initializes ProtocolConfig PDA with correct admin authority", async () => {
    const account = (await program.account.protocolConfig.fetchNullable(
      protocolConfigPda,
    )) as ProtocolConfigAccount | null;

    assert.isNotNull(account, "ProtocolConfig PDA should exist on Devnet");
    assert.ok(account, "ProtocolConfig should be available");
    assert.ok(
      account!.admin.equals(provider.wallet.publicKey),
      "ProtocolConfig admin must match the provider wallet",
    );

    console.log("ProtocolConfig:", {
      admin: account!.admin.toBase58(),
      usdcMint: account!.usdcMint.toBase58(),
      merkleTree: account!.merkleTree.toBase58(),
      kycAuthority: account!.kycAuthority.toBase58(),
      oracleMaxAge: account!.oracleMaxAge.toString(),
      kaminoEnabled: account!.kaminoEnabled,
      bump: account!.bump,
    });
  });

  maybeIt("TEST 2: Initializes CircuitBreaker PDA with correct defaults", async () => {
    const circuitBreaker = (await program.account.circuitBreaker.fetchNullable(
      circuitBreakerPda,
    )) as CircuitBreakerAccount | null;

    assert.isNotNull(circuitBreaker, "CircuitBreaker PDA should exist on Devnet");
    assert.equal(circuitBreaker!.isTripped, false);
    assert.equal(circuitBreaker!.tripCount.toNumber(), 0);
    assert.equal(circuitBreaker!.outflowThisWindow.toNumber(), 0);
    assert.equal(circuitBreaker!.maxOutflowPerWindow.toNumber(), 10_000_000_000);

    originalCircuitBreakerMax = circuitBreaker!.maxOutflowPerWindow;
  });

  maybeIt("TEST 3: User can initialize a vault PDA", async () => {
    const existing = (await program.account.userVault.fetchNullable(
      userVaultPda,
    )) as UserVaultAccount | null;

    if (!existing) {
      await program.methods
        .initializeUser(hashUpiId("integration@upi"))
        .accounts({
          feePayer: provider.wallet.publicKey,
          user: testUser.publicKey,
          userVault: userVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([testUser])
        .rpc({ commitment: "confirmed" });
    }

    const vault = (await program.account.userVault.fetch(userVaultPda)) as UserVaultAccount;
    const availableBalance = vault.totalReceived.sub(vault.totalOfframped).toNumber();

    assert.ok(vault.owner.equals(testUser.publicKey));
    assert.equal(availableBalance, 0, "Fresh vault should start with zero available balance");
    assert.equal(vault.isActive, true, "Vault should be active after initialization");
  });

  maybeIt("TEST 4: User can deposit USDC into vault escrow", async function () {
    const adminUsdcBalance = await provider.connection.getTokenAccountBalance(
      adminUsdcAccount,
      "confirmed",
    ).catch(() => null);

    const adminAmount = Number(adminUsdcBalance?.value.amount ?? "0");
    if (adminAmount < TEST_USDC_AMOUNT) {
      console.log("Skipping deposit test: provider wallet has no Devnet USDC to fund the test user.");
      hasUsdcFunding = false;
      this.skip();
    }

    hasUsdcFunding = true;

    await createAssociatedTokenAccountIdempotent(
      provider.connection,
      (provider.wallet as anchor.Wallet & { payer: Keypair }).payer,
      protocolConfig.usdcMint,
      testUser.publicKey,
    );

    await splTransfer(
      provider.connection,
      (provider.wallet as anchor.Wallet & { payer: Keypair }).payer,
      adminUsdcAccount,
      userUsdcAccount,
      (provider.wallet as anchor.Wallet & { payer: Keypair }).payer,
      TEST_USDC_AMOUNT,
    );

    await program.methods
      .receiveUsdc(new BN(TEST_USDC_AMOUNT), "Integration deposit")
      .accounts({
        feePayer: provider.wallet.publicKey,
        user: testUser.publicKey,
        protocolConfig: protocolConfigPda,
        userVault: userVaultPda,
        userUsdcAccount,
        vaultUsdcAccount,
        usdcMint: protocolConfig.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([testUser])
      .rpc({ commitment: "confirmed" });

    const vault = (await program.account.userVault.fetch(userVaultPda)) as UserVaultAccount;
    const vaultEscrow = await getAccount(provider.connection, vaultUsdcAccount, "confirmed");

    assert.equal(vault.totalReceived.toNumber(), TEST_USDC_AMOUNT);
    assert.equal(vaultEscrow.amount.toString(), String(TEST_USDC_AMOUNT));
    depositCompleted = true;
  });

  maybeIt(
    "TEST 5: Circuit breaker blocks offramp after admin lowers limit below attempted amount",
    async () => {
      await program.methods
        .updateCircuitBreakerConfig({
          newMaxOutflow: new BN(100),
          newWindowDuration: null,
        })
        .accounts({
          admin,
          protocolConfig: protocolConfigPda,
          circuitBreaker: circuitBreakerPda,
        })
        .rpc({ commitment: "confirmed" });

      const vaultBefore = (await program.account.userVault.fetch(userVaultPda)) as UserVaultAccount;
      const blockedOfframpPda = deriveOfframpRequestPda(
        PROGRAM_ID,
        userVaultPda,
        vaultBefore.receiptCount,
      );

      try {
        await program.methods
          .triggerOfframp(new BN(TEST_USDC_AMOUNT), hashUpiId(TEST_UPI), new BN(8_350))
          .accounts({
            feePayer: provider.wallet.publicKey,
            kycAuthority: provider.wallet.publicKey,
            user: testUser.publicKey,
            protocolConfig: protocolConfigPda,
            circuitBreaker: circuitBreakerPda,
            usdcUsdPriceUpdate: USDC_USD_PRICE_UPDATE,
            userVault: userVaultPda,
            offrampRequest: blockedOfframpPda,
            vaultUsdcAccount,
            protocolTreasuryAta,
            usdcMint: protocolConfig.usdcMint,
            merkleTree: protocolConfig.merkleTree,
            treeConfig: treeConfigPda,
            bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
            logWrapper: SPL_NOOP_PROGRAM_ID,
            compressionProgram: SPL_COMPRESSION_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([testUser])
          .rpc({ commitment: "confirmed" });

        assert.fail("Expected CircuitBreakerTripped error");
      } catch (error: any) {
        assert.include(String(error), "CircuitBreakerTripped");
      }

      const tripped = (await program.account.circuitBreaker.fetch(
        circuitBreakerPda,
      )) as CircuitBreakerAccount;
      assert.equal(tripped.isTripped, true);

      await program.methods
        .adminResetCircuitBreaker()
        .accounts({
          admin,
          protocolConfig: protocolConfigPda,
          circuitBreaker: circuitBreakerPda,
        })
        .rpc({ commitment: "confirmed" });

      const reset = (await program.account.circuitBreaker.fetch(
        circuitBreakerPda,
      )) as CircuitBreakerAccount;
      assert.equal(reset.isTripped, false);

      await program.methods
        .updateCircuitBreakerConfig({
          newMaxOutflow: originalCircuitBreakerMax,
          newWindowDuration: null,
        })
        .accounts({
          admin,
          protocolConfig: protocolConfigPda,
          circuitBreaker: circuitBreakerPda,
        })
        .rpc({ commitment: "confirmed" });
    },
  );

  maybeIt("TEST 6: request_offramp rejects wrong Pyth price feed account", async () => {
    const vault = (await program.account.userVault.fetch(userVaultPda)) as UserVaultAccount;
    const offrampRequestPda = deriveOfframpRequestPda(PROGRAM_ID, userVaultPda, vault.receiptCount);

    try {
      await program.methods
        .triggerOfframp(new BN(TEST_USDC_AMOUNT), hashUpiId(TEST_UPI), new BN(8_350))
        .accounts({
          feePayer: provider.wallet.publicKey,
          kycAuthority: provider.wallet.publicKey,
          user: testUser.publicKey,
          protocolConfig: protocolConfigPda,
          circuitBreaker: circuitBreakerPda,
          usdcUsdPriceUpdate: wrongPriceFeed,
          userVault: userVaultPda,
          offrampRequest: offrampRequestPda,
          vaultUsdcAccount,
          protocolTreasuryAta,
          usdcMint: protocolConfig.usdcMint,
          merkleTree: protocolConfig.merkleTree,
          treeConfig: treeConfigPda,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_COMPRESSION_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([testUser])
        .rpc({ commitment: "confirmed" });

      assert.fail("Expected WrongPriceFeedAccount error");
    } catch (error: any) {
      assert.include(String(error), "WrongPriceFeedAccount");
    }
  });

  maybeIt(
    "TEST 7: Full happy path: deposit → offramp → event emitted → PDA locked rate set",
    async function () {
      if (!hasUsdcFunding || !depositCompleted) {
        console.log("Skipping happy path: test wallet was not funded with Devnet USDC in TEST 4.");
        this.skip();
      }

      const vaultBefore = (await program.account.userVault.fetch(userVaultPda)) as UserVaultAccount;
      const offrampRequestPda = deriveOfframpRequestPda(
        PROGRAM_ID,
        userVaultPda,
        vaultBefore.receiptCount,
      );

      const signature = await program.methods
        .triggerOfframp(new BN(TEST_USDC_AMOUNT), hashUpiId(TEST_UPI), new BN(8_350))
        .accounts({
          feePayer: provider.wallet.publicKey,
          kycAuthority: provider.wallet.publicKey,
          user: testUser.publicKey,
          protocolConfig: protocolConfigPda,
          circuitBreaker: circuitBreakerPda,
          usdcUsdPriceUpdate: USDC_USD_PRICE_UPDATE,
          userVault: userVaultPda,
          offrampRequest: offrampRequestPda,
          vaultUsdcAccount,
          protocolTreasuryAta,
          usdcMint: protocolConfig.usdcMint,
          merkleTree: protocolConfig.merkleTree,
          treeConfig: treeConfigPda,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_PROGRAM_ID,
          compressionProgram: SPL_COMPRESSION_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([testUser])
        .rpc({ commitment: "confirmed" });

      const offrampRequest = (await program.account.offrampRequest.fetch(
        offrampRequestPda,
      )) as OfframpRequestAccount;

      assert.isAbove(offrampRequest.lockedUsdcUsdPrice.toNumber(), 0);
      assert.isAbove(
        offrampRequest.priceLockedAt.toNumber(),
        Math.floor(Date.now() / 1000) - 30,
      );
      assert.isBelow(offrampRequest.priceExpo, 0);

      const transaction = await provider.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      assert.isNotNull(transaction, "Confirmed transaction should be retrievable from Devnet");
      const logMessages = transaction?.meta?.logMessages ?? [];

      const eventParser = new EventParser(PROGRAM_ID, new BorshCoder(program.idl as Idl));
      const parsedEvents = Array.from(eventParser.parseLogs(logMessages)).filter(
        (event) => event.name === "OfframpRequested",
      ) as Array<{ name: string; data: ParsedOfframpEvent }>;

      assert.isAbove(parsedEvents.length, 0, "Expected OfframpRequested event in transaction logs");
      assert.deepEqual(parsedEvents[0].data.destinationUpiHash, hashUpiId(TEST_UPI));
      happyPathOfframpRequestPda = offrampRequestPda;
      happyPathReceiptId = offrampRequest.receiptId;

      console.log("Locked USDC/USD:", offrampRequest.lockedUsdcUsdPrice.toString());
    },
  );

  maybeIt("TEST 8: Full offramp mints cNFT receipt to user wallet", async function () {
    this.timeout(180_000);

    if (!happyPathOfframpRequestPda || happyPathReceiptId === null) {
      console.log("Skipping cNFT receipt verification because the happy path offramp did not run.");
      this.skip();
    }

    const heliusApiKey = readEnvValueFromFrontend("HELIUS_API_KEY");
    assert.isOk(
      heliusApiKey,
      "HELIUS_API_KEY must be available to verify cNFT receipt via Helius DAS",
    );

    const walletAddress = testUser.publicKey.toBase58();
    const requestId = happyPathOfframpRequestPda.toBase58();
    const expectedName = `RailPay Receipt #${happyPathReceiptId}`;
    const heliusRpcUrl = `https://devnet.helius-rpc.com/?api-key=${heliusApiKey}`;

    let matchedAsset: HeliusAsset | undefined;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await fetch(heliusRpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "railpay-cnft-check",
          method: "getAssetsByOwner",
          params: {
            ownerAddress: walletAddress,
            page: 1,
            limit: 100,
            displayOptions: {
              showCollectionMetadata: true,
            },
          },
        }),
      });

      assert.isTrue(response.ok, "Helius DAS RPC should respond successfully");

      const payload = (await response.json()) as HeliusAssetResponse;
      const items = payload.result?.items ?? [];

      matchedAsset = items.find((item) => {
        const name = item.content?.metadata?.name ?? "";
        const uri = item.content?.json_uri ?? "";
        return (
          item.compression?.compressed === true &&
          name === expectedName &&
          uri.includes(requestId)
        );
      });

      if (matchedAsset) {
        break;
      }

      await sleep(4_000);
    }

    assert.isOk(matchedAsset, "Expected a compressed Bubblegum receipt owned by the test wallet");
    assert.include(
      matchedAsset?.content?.json_uri ?? "",
      requestId,
      "cNFT metadata URI should include the offramp request ID",
    );
  });

  if (!runOnDevnet) {
    it("skips the integration suite outside Devnet", () => {
      assert.match(
        provider.connection.rpcEndpoint,
        /localhost|127\.0\.0\.1|localnet/i,
        "Expected non-Devnet runs to use a local validator",
      );
    });
  }
});
