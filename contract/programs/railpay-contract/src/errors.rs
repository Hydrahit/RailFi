use anchor_lang::prelude::*;

#[error_code]
pub enum RailpayError {
    #[msg("Amount must be at least 0.01 USDC (10_000 micro-USDC)")]
    AmountTooSmall,
    #[msg("Insufficient USDC balance in vault")]
    InsufficientBalance,
    #[msg("Vault escrow ATA does not currently hold enough USDC")]
    InsufficientEscrowBalance,
    #[msg("You are not the owner of this vault")]
    UnauthorizedAccess,
    #[msg("This vault has been deactivated")]
    VaultInactive,
    #[msg("The supplied USDC mint is not approved by protocol config")]
    InvalidUsdcMint,
    #[msg("The supplied Merkle tree is not approved by protocol config")]
    InvalidMerkleTree,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Note exceeds 100 character limit")]
    NoteTooLong,
    #[msg("UPI handle exceeds 50 character limit")]
    HandleTooLong,
    #[msg("UPI handle must fit in 32 bytes for deterministic on-chain storage")]
    HandleTooLongForStorage,
    #[msg("UPI handle format is invalid")]
    InvalidUpiHandle,
    #[msg("UPI handle hash is invalid")]
    InvalidUpiHash,
    #[msg("Failed to serialize Bubblegum instruction data")]
    SerializationError,
    #[msg("Bubblegum CPI invocation failed")]
    CpiError,
    #[msg("Unauthorized - caller is not the admin authority")]
    Unauthorized,
    #[msg("Circuit breaker is tripped - withdrawals paused")]
    CircuitBreakerTripped,
    #[msg("Circuit breaker config must be greater than zero")]
    InvalidCircuitBreakerConfig,
    #[msg("Pyth price feed is older than the configured maximum age")]
    StalePriceFeed,
    #[msg("Pyth price confidence interval exceeds 0.5% - market too volatile")]
    PriceConfidenceTooWide,
    #[msg("Wrong price feed account - does not match expected Pyth feed pubkey")]
    WrongPriceFeedAccount,
    #[msg("KYC authorization is required before triggering an offramp")]
    MissingKycAuthorization,
    #[msg("KYC authority signer does not match the configured protocol authority")]
    InvalidKycAuthority,
    #[msg("Fee payer does not match the configured relayer authority")]
    InvalidRelayerAuthority,
    #[msg("Referral fee bps must be between 1 and 5000")]
    InvalidFeeBps,
    #[msg("Referral config is not active")]
    InactiveReferral,
    #[msg("Referral accounts are invalid for this offramp")]
    InvalidReferralAccounts,
    #[msg("Referrer USDC token account is invalid")]
    InvalidReferrerTokenAccount,
    #[msg("Users cannot self-refer an offramp request")]
    SelfReferralNotAllowed,
    #[msg("Protocol treasury ATA is invalid")]
    InvalidProtocolTreasuryAccount,
    #[msg("Protocol config account is invalid")]
    InvalidProtocolConfigAccount,
    #[msg("Oracle max age must be greater than zero")]
    InvalidOracleMaxAge,
}

pub use RailpayError as RailPayError;
