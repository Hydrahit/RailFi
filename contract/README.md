<div align="center">

```
 ██████╗ ███╗   ██╗      ██████╗██╗  ██╗ █████╗ ██╗███╗   ██╗
██╔═══██╗████╗  ██║     ██╔════╝██║  ██║██╔══██╗██║████╗  ██║
██║   ██║██╔██╗ ██║     ██║     ███████║███████║██║██╔██╗ ██║
██║   ██║██║╚██╗██║     ██║     ██╔══██║██╔══██║██║██║╚██╗██║
╚██████╔╝██║ ╚████║     ╚██████╗██║  ██║██║  ██║██║██║ ╚████║
 ╚═════╝ ╚═╝  ╚═══╝      ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝
```

### **The On-Chain Enforcement Layer**
*Vault escrow · Oracle validation · Circuit breaker · Referral accounting*

---

[![Rust](https://img.shields.io/badge/Rust-1.75+-CE422B?style=for-the-badge&logo=rust&logoColor=white)](https://rust-lang.org)
[![Anchor](https://img.shields.io/badge/Anchor-0.29-9945FF?style=for-the-badge)](https://anchor-lang.com)
[![Solana](https://img.shields.io/badge/Solana-Devnet-14F195?style=for-the-badge&logo=solana&logoColor=black)](https://solana.com)
[![Pyth](https://img.shields.io/badge/Oracle-Pyth%20Network-E6007A?style=for-the-badge)](https://pyth.network)
[![Light Protocol](https://img.shields.io/badge/Compression-Light%20Protocol-7C3AED?style=for-the-badge)](https://lightprotocol.com)
[![Program Seed](https://img.shields.io/badge/Config%20Seed-protocol__config__v2-22D3EE?style=for-the-badge)](https://explorer.solana.com)

</div>

---

## What This Program Does

This is the `contract/` subrepo of the RailFi monorepo. It contains the **Anchor/Rust Solana program** that is the single source of truth for all settlement enforcement.

No USDC moves unless this program approves it. No fiat payout is valid without a confirmed instruction from this program. It is the **trust anchor** for the entire RailFi protocol.

**Core responsibilities:**
- Accept USDC into program-owned vault ATAs with user signatures
- Validate Pyth oracle prices for FX rate integrity at settlement time
- Write immutable `OfframpRequest` receipts with hashed payout destinations
- Enforce fee collection, referral splits, and protocol configuration
- Operate a rolling-window circuit breaker that halts settlement on abnormal outflow

---

## The Five On-Chain Accounts

```mermaid
erDiagram
    PROTOCOL_CONFIG {
        pubkey admin
        pubkey relayer_authority
        pubkey usdc_mint
        pubkey merkle_tree
        pubkey kyc_authority
        u64 oracle_max_age
        bool use_kamino_benchmark
    }
    USER_VAULT {
        pubkey owner
        bytes32 hashed_upi_handle
        u64 cumulative_received
        u64 cumulative_offramped
        u64 receipt_counter
        bool active
    }
    OFFRAMP_REQUEST {
        pubkey user
        pubkey vault
        u64 usdc_amount
        u64 inr_quote
        u64 receipt_id
        bytes32 hashed_destination_upi
        i64 timestamp
        i64 locked_pyth_price
        i32 price_exponent
        u64 price_confidence
        i64 lock_time
    }
    REFERRAL_CONFIG {
        pubkey referrer
        u16 fee_basis_points
        u64 total_earned
        u64 total_referred
    }
    CIRCUIT_BREAKER {
        pubkey authority
        u64 max_outflow_per_window
        i64 window_duration
        u64 current_outflow
        bool tripped
        u64 trip_count
    }

    PROTOCOL_CONFIG ||--o{ USER_VAULT : "governs"
    USER_VAULT ||--o{ OFFRAMP_REQUEST : "generates"
    OFFRAMP_REQUEST }o--o| REFERRAL_CONFIG : "may reference"
    PROTOCOL_CONFIG ||--|| CIRCUIT_BREAKER : "paired with"
```

---

## Instruction Set

```mermaid
flowchart TD
    subgraph ADMIN ["🔐 Admin Instructions"]
        I1[initialize_protocol\nSet config, authorities, oracle params]
        I2[update_protocol_config\nAdmin-only parameter updates]
        I3[reset_circuit_breaker\nAuthority-gated trip reset]
    end

    subgraph USER ["👤 User Instructions"]
        I4[initialize_vault\nCreate UserVault PDA + ATA]
        I5[deposit_to_vault\nTransfer USDC → program vault ATA]
    end

    subgraph SETTLEMENT ["⚡ Settlement Instructions (Relayer-Gated)"]
        I6[trigger_offramp\n★ Core settlement instruction]
        I7[initialize_referral\nCreate ReferralConfig PDA]
    end

    subgraph COMPRESSION ["🗜️ Compression Instructions"]
        I8[compress_offramp_receipt\nBubblegum-compatible cNFT mint]
    end

    I6 --> V1{Relayer authority\n== protocol_config\n.relayer_authority?}
    V1 -- ❌ --> FAIL1[Transaction Rejected]
    V1 -- ✅ --> V2{KYC signer\n== protocol_config\n.kyc_authority?}
    V2 -- ❌ --> FAIL2[Transaction Rejected]
    V2 -- ✅ --> V3{Pyth price feed\nidentity check}
    V3 -- ❌ --> FAIL3[Transaction Rejected]
    V3 -- ✅ --> V4{Price staleness\n< oracle_max_age?}
    V4 -- ❌ --> FAIL4[Stale Oracle Rejected]
    V4 -- ✅ --> V5{Confidence interval\nwithin bounds?}
    V5 -- ❌ --> FAIL5[Wide CI Rejected]
    V5 -- ✅ --> V6{Circuit breaker\ntripped?}
    V6 -- ❌ TRIPPED --> FAIL6[Settlement Halted]
    V6 -- ✅ CLEAR --> V7{Outflow + amount\n≤ max_per_window?}
    V7 -- ❌ --> TRIP[🔴 Trip circuit breaker\nWrite trip_count + 1]
    V7 -- ✅ --> EXEC[✅ Execute Settlement\nDeduct fees + referral\nWrite OfframpRequest\nUpdate outflow window]

    style ADMIN fill:#1a0d0d,color:#FF6B6B,stroke:#FF6B6B
    style USER fill:#0d0d1a,color:#9945FF,stroke:#9945FF
    style SETTLEMENT fill:#0d1a0d,color:#14F195,stroke:#14F195
    style COMPRESSION fill:#1a1a0d,color:#FFD700,stroke:#FFD700
    style EXEC fill:#0d2a0d,color:#14F195,stroke:#14F195
    style TRIP fill:#2a0d0d,color:#FF6B6B,stroke:#FF6B6B
```

---

## The `trigger_offramp` Instruction: Deep Dive

This is the **most critical instruction** in the protocol. Every validation listed below must pass or the transaction fails atomically — no partial state.

### Validation Checklist (in order)

```
SIGNER CHECKS
═══════════════
□  tx.fee_payer  == protocol_config.relayer_authority
   → Ensures only the authorised gasless relayer submits settlements
   → Users cannot self-submit and bypass policy

□  kyc_signer   == protocol_config.kyc_authority
   → Ensures KYC attestation is from the authorised issuer
   → Prevents fake KYC from untrusted signers

ORACLE CHECKS
═══════════════
□  price_feed.key == canonical USDC/USD Pyth feed address
   → Feed identity must match exactly — no substitute oracles

□  price.publish_time >= now - oracle_max_age
   → Stale prices rejected (default: 60 seconds)
   → Prevents exploitation of stale FX rates

□  price.conf / price.price <= MAX_CONFIDENCE_RATIO
   → Wide confidence intervals rejected
   → Prevents settlement during oracle uncertainty / thin markets

CIRCUIT BREAKER CHECKS
═══════════════════════
□  circuit_breaker.tripped == false
   → If tripped, ALL settlements halt until authority resets

□  Roll window if (now - window_start) > window_duration
   → Sliding window resets current_outflow

□  current_outflow + amount <= max_outflow_per_window
   → If exceeded: trip breaker, increment trip_count, reject tx

ACCOUNTING
═══════════════
□  protocol_fee   = amount * protocol_fee_bps / 10_000
□  referral_fee   = amount * referral_fee_bps / 10_000  (if referral provided)
□  user_receives  = amount - protocol_fee - referral_fee
□  total_deducted = protocol_fee + referral_fee + user_receives
   → Must equal original amount (no rounding loss)

STATE WRITES (only if all above pass)
════════════════════════════════════
□  Transfer USDC from user ATA → vault ATA
□  Transfer protocol fee → protocol fee ATA
□  Transfer referral fee → referrer ATA (if applicable)
□  Write OfframpRequest { amount, inr_quote, hashed_upi, price, timestamp }
□  Increment UserVault.cumulative_offramped + receipt_counter
□  Increment CircuitBreaker.current_outflow
□  Update ReferralConfig.total_earned + total_referred (if applicable)
```

### Why UPI is Hashed On-Chain

The `hashed_destination_upi` field stores a `sha256` digest of the UPI handle — **never the plaintext**. This gives:

1. **Privacy** — UPI IDs are not publicly readable from the Solana explorer
2. **Verifiability** — The server can prove a payout went to the claimed UPI by comparing hashes
3. **Immutability** — The destination is locked at the time of signing; no post-hoc modification

---

## Account Structures (Rust)

```rust
#[account]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub relayer_authority: Pubkey,    // Must co-sign every settlement
    pub usdc_mint: Pubkey,
    pub merkle_tree: Pubkey,          // For Light Protocol compression
    pub kyc_authority: Pubkey,        // Must co-sign every settlement
    pub oracle_max_age: u64,          // Pyth staleness threshold (seconds)
    pub use_kamino_benchmark: bool,
}

#[account]
pub struct UserVault {
    pub owner: Pubkey,
    pub hashed_upi_handle: [u8; 32],  // sha256 of UPI ID
    pub cumulative_received: u64,     // Total USDC deposited (micro)
    pub cumulative_offramped: u64,    // Total USDC settled (micro)
    pub receipt_counter: u64,         // Monotonic receipt ID
    pub active: bool,
}

#[account]
pub struct OfframpRequest {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub usdc_amount: u64,             // In micro-USDC (6 decimals)
    pub inr_quote: u64,               // Locked INR amount at time of signing
    pub receipt_id: u64,              // From UserVault.receipt_counter
    pub hashed_destination_upi: [u8; 32],
    pub timestamp: i64,
    pub locked_pyth_price: i64,       // Price at settlement time
    pub price_exponent: i32,
    pub price_confidence: u64,
    pub lock_time: i64,
}

#[account]
pub struct ReferralConfig {
    pub referrer: Pubkey,
    pub fee_basis_points: u16,        // e.g. 50 = 0.5%
    pub total_earned: u64,            // Cumulative referral fees earned
    pub total_referred: u64,          // Number of offramp events referred
}

#[account]
pub struct CircuitBreaker {
    pub authority: Pubkey,            // Can reset tripped state
    pub max_outflow_per_window: u64,  // USDC limit per window
    pub window_duration: i64,         // Window length in seconds
    pub current_outflow: u64,         // Accumulated in current window
    pub tripped: bool,                // When true: ALL settlements blocked
    pub trip_count: u64,              // Audit trail of trip events
}
```

---

## PDA Derivation

```
ProtocolConfig:   ["protocol_config_v2"]
UserVault:        ["user_vault", user_pubkey]
OfframpRequest:   ["offramp_request", user_pubkey, receipt_id_bytes]
ReferralConfig:   ["referral_config", referrer_pubkey]
CircuitBreaker:   ["circuit_breaker", protocol_config_pubkey]
Vault ATA:        getAssociatedTokenAddress(vault_pda, usdc_mint)
```

> **Note:** The seed `protocol_config_v2` reflects a migration from a previous layout (`protocol_config`). Both frontend and program tooling use `v2` exclusively.

---

## Circuit Breaker: The Last Line of Defence

```mermaid
sequenceDiagram
    participant TX as Incoming Settlement
    participant CB as CircuitBreaker Account
    participant AUTH as Authority (Admin)

    TX->>CB: Read current_outflow + window state
    CB-->>TX: window_start, current_outflow, max, tripped

    alt Circuit already tripped
        TX-->>TX: ❌ Reject: CB_TRIPPED error
    else Window expired
        TX->>CB: Reset current_outflow = 0, window_start = now
    end

    TX->>CB: Check: current_outflow + amount ≤ max_outflow_per_window
    alt Limit exceeded
        TX->>CB: Set tripped = true, trip_count += 1
        TX-->>TX: ❌ Reject: CIRCUIT_BREAKER_TRIPPED
    else Within limit
        TX->>CB: current_outflow += amount
        TX-->>TX: ✅ Proceed to fee accounting
    end

    Note over AUTH,CB: To resume after trip:
    AUTH->>CB: reset_circuit_breaker instruction
    CB-->>CB: tripped = false
```

**What trips the breaker?** Abnormal USDC outflow velocity within a rolling time window. This catches:
- Exploit attempts draining the vault rapidly
- Oracle manipulation enabling artificially large settlements
- Operational errors causing duplicate payouts

**Who resets it?** Only the `circuit_breaker.authority` — a dedicated admin key, not the relayer. This separation of keys means a compromised relayer cannot reset a tripped breaker.

---

## Fee Accounting Model

```
Settlement Amount:  1,000 USDC
                    ─────────────────────────────────
Protocol Fee:         10 USDC  (example: 100 bps / 1%)
Referral Fee:          5 USDC  (example:  50 bps / 0.5%) ← only if referral
                    ─────────────────────────────────
User Receives:       985 USDC  → converted to INR via locked Pyth price
                    ═════════════════════════════════
Total:             1,000 USDC  ← must equal input (enforced on-chain)
```

- Protocol fee goes to `protocol_config` fee ATA
- Referral fee goes to `referral_config.referrer` ATA
- All three transfers occur atomically in the same instruction
- If arithmetic doesn't reconcile: transaction fails

---

## Light Protocol: Compressed Receipts

After a successful `trigger_offramp`, the `compress_offramp_receipt` instruction mints a **compressed NFT receipt** via a Bubblegum-compatible path:

```
OfframpRequest account data
        ↓
Bubblegum cNFT leaf
        ↓
Merkle tree (merkle_tree in ProtocolConfig)
        ↓
User wallet (compressed on-chain proof of settlement)
```

This gives users a verifiable, on-chain, permanently compressed record of every settlement — usable for tax documentation, audit trails, and CA verification — at a fraction of the cost of a full NFT.

---

## Directory Structure

```
contract/
├── programs/
│   └── railpay-contract/
│       ├── src/
│       │   ├── lib.rs                  # Program entrypoint + instruction routing
│       │   ├── instructions/
│       │   │   ├── initialize.rs       # Protocol + vault initialisation
│       │   │   ├── trigger_offramp.rs  # ★ Core settlement instruction
│       │   │   ├── circuit_breaker.rs  # Trip logic + reset instruction
│       │   │   ├── referral.rs         # ReferralConfig init + accounting
│       │   │   └── compress.rs         # Light Protocol cNFT minting
│       │   ├── state/
│       │   │   ├── protocol_config.rs
│       │   │   ├── user_vault.rs
│       │   │   ├── offramp_request.rs
│       │   │   ├── referral_config.rs
│       │   │   └── circuit_breaker.rs
│       │   └── errors.rs               # Custom error codes
│       └── Cargo.toml
├── tests/
│   └── railpay-contract.ts             # Anchor TypeScript integration tests
├── Anchor.toml                         # Program ID + cluster config
└── Cargo.toml
```

*★ = Settlement-critical path*

---

## Build & Deploy

```bash
# Prerequisites: Rust, Solana CLI, Anchor CLI 0.29

# Install Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --tag v0.29.0

# Build program
anchor build

# Run tests (Devnet)
anchor test --provider.cluster devnet

# Deploy to Devnet
anchor deploy --provider.cluster devnet

# Verify program ID matches Anchor.toml
solana program show <PROGRAM_ID> --url devnet
```

### After Deploy

Copy the deployed program ID into `frontend/.env.local`:
```bash
NEXT_PUBLIC_PROGRAM_ID=<your_deployed_program_id>
```

The frontend derives all PDAs from this program ID at runtime.

---

## Error Codes

| Code | Name | Triggered When |
|------|------|----------------|
| `6000` | `InvalidRelayerAuthority` | Fee payer ≠ `protocol_config.relayer_authority` |
| `6001` | `InvalidKycAuthority` | KYC signer ≠ `protocol_config.kyc_authority` |
| `6002` | `InvalidPriceFeed` | Pyth feed key doesn't match canonical USDC/USD feed |
| `6003` | `StalePriceData` | `publish_time` older than `oracle_max_age` |
| `6004` | `PriceConfidenceTooWide` | Confidence interval exceeds max ratio |
| `6005` | `CircuitBreakerTripped` | `circuit_breaker.tripped == true` |
| `6006` | `OutflowWindowExceeded` | This transaction would trip the circuit breaker |
| `6007` | `ArithmeticOverflow` | Fee accounting doesn't reconcile to input amount |
| `6008` | `VaultNotActive` | `user_vault.active == false` |
| `6009` | `UnauthorizedReset` | Reset signer ≠ `circuit_breaker.authority` |

---

## Security Properties

| Property | How It's Enforced |
|----------|------------------|
| **Only relayer can submit settlements** | Signer check against `protocol_config.relayer_authority` |
| **Only KYC authority can attest** | Signer check against `protocol_config.kyc_authority` |
| **No stale FX rates** | Pyth `publish_time` checked against `oracle_max_age` |
| **No thin-market manipulation** | Confidence width bounded before settlement |
| **Abnormal velocity halts protocol** | Circuit breaker auto-trips on window overflow |
| **UPI destination is immutable** | Hashed at signing, stored on-chain, never plaintext |
| **Fee arithmetic is exact** | On-chain reconciliation: fees + user amount must equal input |
| **Compressed receipts are permanent** | Light Protocol cNFT on Solana — not deletable |

---

<div align="center">

**Part of the [RailFi](../README.md) monorepo.**

[![Rust](https://img.shields.io/badge/Rust-CE422B?style=flat-square&logo=rust)](https://rust-lang.org)
[![Anchor](https://img.shields.io/badge/Anchor-0.29-9945FF?style=flat-square)](https://anchor-lang.com)
[![Pyth](https://img.shields.io/badge/Oracle-Pyth-E6007A?style=flat-square)](https://pyth.network)

*The chain doesn't trust. It verifies.*

</div>
