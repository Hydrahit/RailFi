import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import { BPF_LOADER_UPGRADEABLE_PROGRAM_ID, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

function deriveOfframpRequestPda(
  programId: PublicKey,
  vault: PublicKey,
  currentReceiptCount: number,
): PublicKey {
  const receiptSeed = Buffer.alloc(4);
  receiptSeed.writeUInt32LE(currentReceiptCount, 0);
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("offramp_request"), vault.toBuffer(), receiptSeed],
    programId,
  )[0];
}

describe("Circuit Breaker", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.RailpayContract as Program<any>;
  const admin = provider.wallet as anchor.Wallet;
  const payer = admin.payer;

  let circuitBreakerPda: anchor.web3.PublicKey;
  let protocolConfigPda: anchor.web3.PublicKey;
  let programDataPda: anchor.web3.PublicKey;
  let userVaultPda: anchor.web3.PublicKey;
  let treeConfigPda: anchor.web3.PublicKey;
  let usdcMint: PublicKey;
  let userUsdcAccount: PublicKey;
  let vaultUsdcAccount: PublicKey;

  const merkleTree = new PublicKey("EzgywgnDidZX55z2U3UESgbVaGJiSSCWprHGKURht3xw");
  const bubblegumProgram = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
  const compressionProgram = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
  const logWrapper = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");
  const usdcUsdPriceUpdate = new PublicKey("EF6U755BdHMXim8RBw6XSC6Yk6XaouTKpwcBZ7QkcanB");
  const TEST_ORACLE_MAX_AGE = 31_536_000;
  type CircuitBreakerAccount = {
    isTripped: boolean;
    tripCount: anchor.BN;
    outflowThisWindow: anchor.BN;
    maxOutflowPerWindow: anchor.BN;
    windowDurationSeconds: anchor.BN;
    authority: PublicKey;
  };

  before(async () => {
    [circuitBreakerPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("circuit_breaker")],
      program.programId,
    );
    [protocolConfigPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("protocol_config")],
      program.programId,
    );
    [programDataPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    );
    [userVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("user_vault"), admin.publicKey.toBuffer()],
      program.programId,
    );
    [treeConfigPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [merkleTree.toBuffer()],
      bubblegumProgram,
    );

    usdcMint = await createMint(provider.connection, payer, admin.publicKey, null, 6);
    userUsdcAccount = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        usdcMint,
        admin.publicKey,
      )
    ).address;
    await mintTo(
      provider.connection,
      payer,
      usdcMint,
      userUsdcAccount,
      admin.publicKey,
      20_000_000_000,
    );
    vaultUsdcAccount = await getAssociatedTokenAddress(usdcMint, userVaultPda, true);
  });

  it("TEST 1: Initializes circuit breaker with correct defaults", async () => {
    await program.methods
      .initializeProtocol(
        admin.publicKey,
        admin.publicKey,
        false,
        new anchor.BN(TEST_ORACLE_MAX_AGE),
      )
      .accounts({
        admin: admin.publicKey,
        railpayProgram: program.programId,
        programData: programDataPda,
        protocolConfig: protocolConfigPda,
        usdcMint,
        merkleTree,
        treeConfig: treeConfigPda,
        bubblegumProgram,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .initializeCircuitBreaker()
      .accounts({
        admin: admin.publicKey,
        protocolConfig: protocolConfigPda,
        circuitBreaker: circuitBreakerPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const cb = (await program.account.circuitBreaker.fetch(
      circuitBreakerPda,
    )) as CircuitBreakerAccount;
    assert.equal(cb.isTripped, false);
    assert.equal(cb.tripCount.toNumber(), 0);
    assert.equal(cb.outflowThisWindow.toNumber(), 0);
    assert.equal(cb.maxOutflowPerWindow.toNumber(), 10_000_000_000);
    assert.equal(cb.windowDurationSeconds.toNumber(), 3600);
    assert.ok(cb.authority.equals(admin.publicKey));
  });

  it("TEST 2: Allows offramp within window limit", async () => {
    await program.methods
      .initializeUser("tester@okicici")
      .accounts({
        feePayer: admin.publicKey,
        user: admin.publicKey,
        userVault: userVaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .receiveUsdc(new anchor.BN(2_000_000_000), "Circuit breaker funding")
      .accounts({
        feePayer: admin.publicKey,
        user: admin.publicKey,
        protocolConfig: protocolConfigPda,
        userVault: userVaultPda,
        userUsdcAccount,
        vaultUsdcAccount,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const offrampRequestPda = deriveOfframpRequestPda(program.programId, userVaultPda, 0);
    await program.methods
      .triggerOfframp(new anchor.BN(1_000_000_000), "settlement@upi", new anchor.BN(83_500_000_000))
      .accounts({
        feePayer: admin.publicKey,
        kycAuthority: admin.publicKey,
        user: admin.publicKey,
        protocolConfig: protocolConfigPda,
        circuitBreaker: circuitBreakerPda,
        usdcUsdPriceUpdate,
        userVault: userVaultPda,
        offrampRequest: offrampRequestPda,
        vaultUsdcAccount,
        usdcMint,
        merkleTree,
        treeConfig: treeConfigPda,
        bubblegumProgram,
        logWrapper,
        compressionProgram,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const cb = (await program.account.circuitBreaker.fetch(
      circuitBreakerPda,
    )) as CircuitBreakerAccount;
    assert.equal(cb.outflowThisWindow.toNumber(), 1_000_000_000);
  });

  it("TEST 3: Trips circuit breaker when limit exceeded", async () => {
    await program.methods
      .updateCircuitBreakerConfig({
        newMaxOutflow: new anchor.BN(1_000_000),
        newWindowDuration: null,
      })
      .accounts({
        admin: admin.publicKey,
        protocolConfig: protocolConfigPda,
        circuitBreaker: circuitBreakerPda,
      })
      .rpc();

    const offrampRequestPda = deriveOfframpRequestPda(program.programId, userVaultPda, 1);
    try {
      await program.methods
        .triggerOfframp(new anchor.BN(2_000_000), "limit@upi", new anchor.BN(167_000_000))
        .accounts({
          feePayer: admin.publicKey,
          kycAuthority: admin.publicKey,
          user: admin.publicKey,
          protocolConfig: protocolConfigPda,
          circuitBreaker: circuitBreakerPda,
          usdcUsdPriceUpdate,
          userVault: userVaultPda,
          offrampRequest: offrampRequestPda,
          vaultUsdcAccount,
          usdcMint,
          merkleTree,
          treeConfig: treeConfigPda,
          bubblegumProgram,
          logWrapper,
          compressionProgram,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown CircuitBreakerTripped");
    } catch (err: any) {
      assert.include(err.toString(), "CircuitBreakerTripped");
    }

    const cb = (await program.account.circuitBreaker.fetch(
      circuitBreakerPda,
    )) as CircuitBreakerAccount;
    assert.equal(cb.isTripped, true);
    assert.equal(cb.tripCount.toNumber(), 1);
  });

  it("TEST 4: Admin resets breaker and subsequent offramp succeeds", async () => {
    await program.methods
      .adminResetCircuitBreaker()
      .accounts({
        admin: admin.publicKey,
        protocolConfig: protocolConfigPda,
        circuitBreaker: circuitBreakerPda,
      })
      .rpc();

    const resetCb = (await program.account.circuitBreaker.fetch(
      circuitBreakerPda,
    )) as CircuitBreakerAccount;
    assert.equal(resetCb.isTripped, false);
    assert.equal(resetCb.outflowThisWindow.toNumber(), 0);

    await program.methods
      .updateCircuitBreakerConfig({
        newMaxOutflow: new anchor.BN(10_000_000_000),
        newWindowDuration: null,
      })
      .accounts({
        admin: admin.publicKey,
        protocolConfig: protocolConfigPda,
        circuitBreaker: circuitBreakerPda,
      })
      .rpc();

    const offrampRequestPda = deriveOfframpRequestPda(program.programId, userVaultPda, 1);
    await program.methods
      .triggerOfframp(new anchor.BN(1_000_000), "postreset@upi", new anchor.BN(83_500_000))
      .accounts({
        feePayer: admin.publicKey,
        kycAuthority: admin.publicKey,
        user: admin.publicKey,
        protocolConfig: protocolConfigPda,
        circuitBreaker: circuitBreakerPda,
        usdcUsdPriceUpdate,
        userVault: userVaultPda,
        offrampRequest: offrampRequestPda,
        vaultUsdcAccount,
        usdcMint,
        merkleTree,
        treeConfig: treeConfigPda,
        bubblegumProgram,
        logWrapper,
        compressionProgram,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const cb = (await program.account.circuitBreaker.fetch(
      circuitBreakerPda,
    )) as CircuitBreakerAccount;
    assert.equal(cb.isTripped, false);
  });
});
