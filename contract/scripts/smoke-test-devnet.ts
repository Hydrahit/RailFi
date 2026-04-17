import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import idl from "../target/idl/railpay_contract.json";
import type { RailpayContract } from "../target/types/railpay_contract";

const DEVNET_RPC = "https://api.devnet.solana.com";

function decodeSecretKey(encoded: string): Uint8Array {
  const trimmed = encoded.trim();
  if (trimmed.startsWith("[")) {
    return Uint8Array.from(JSON.parse(trimmed) as number[]);
  }
  return anchor.utils.bytes.bs58.decode(trimmed);
}

function getProgramId(): PublicKey {
  const fromEnv = process.env.PROGRAM_ID?.trim();
  if (fromEnv) {
    return new PublicKey(fromEnv);
  }

  const fromMetadata = (idl as { metadata?: { address?: string } }).metadata?.address;
  if (fromMetadata) {
    return new PublicKey(fromMetadata);
  }

  throw new Error("PROGRAM_ID is missing and metadata.address is not available in the generated IDL.");
}

async function main(): Promise<void> {
  const rawSecret = process.env.DEPLOY_KEYPAIR?.trim();
  if (!rawSecret) {
    throw new Error("DEPLOY_KEYPAIR env var is required and must contain a base58 or JSON-encoded secret key.");
  }

  const admin = Keypair.fromSecretKey(decodeSecretKey(rawSecret));
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const program = new Program<RailpayContract>(
    idl as RailpayContract,
    getProgramId(),
    provider,
  );

  const [protocolConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config_v2")],
    program.programId,
  );
  console.log("ProtocolConfig PDA:", protocolConfigPda.toBase58());

  const protocolConfigNamespace = program.account as Record<
    string,
    { fetchNullable: (address: PublicKey) => Promise<unknown> }
  >;
  const protocolConfig = await protocolConfigNamespace.protocolConfig.fetchNullable(protocolConfigPda);

  if (!protocolConfig) {
    throw new Error(`ProtocolConfig account ${protocolConfigPda.toBase58()} does not exist on Devnet.`);
  }

  const adminAuthority =
    (protocolConfig as { adminAuthority?: PublicKey }).adminAuthority ??
    (protocolConfig as { admin?: PublicKey }).admin;

  if (!adminAuthority) {
    throw new Error("ProtocolConfig exists but does not expose an admin or adminAuthority field.");
  }

  if (!adminAuthority.equals(admin.publicKey)) {
    throw new Error(
      `ProtocolConfig admin mismatch. Expected ${admin.publicKey.toBase58()}, found ${adminAuthority.toBase58()}.`,
    );
  }

  const [circuitBreakerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("circuit_breaker")],
    program.programId,
  );
  console.log("CircuitBreaker PDA:", circuitBreakerPda.toBase58());

  const hasCircuitBreaker = "circuitBreaker" in protocolConfigNamespace;

  if (hasCircuitBreaker) {
    const circuitBreaker = await protocolConfigNamespace.circuitBreaker.fetchNullable(circuitBreakerPda);
    if (!circuitBreaker) {
      throw new Error(`CircuitBreaker account ${circuitBreakerPda.toBase58()} does not exist on Devnet.`);
    }

    const isTripped =
      (circuitBreaker as { isTripped?: boolean }).isTripped ??
      (circuitBreaker as { is_tripped?: boolean }).is_tripped;

    if (isTripped !== false) {
      throw new Error(`CircuitBreaker expected is_tripped=false but received ${String(isTripped)}.`);
    }
  } else {
    console.warn("CircuitBreaker is not present in the current IDL yet; skipping breaker assertion.");
  }

  console.log(`✅ Smoke test passed. Program deployed and PDAs verified at ${new Date().toISOString()}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke test failed: ${message}`);
  process.exit(1);
});
