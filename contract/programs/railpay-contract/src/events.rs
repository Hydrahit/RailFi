use anchor_lang::prelude::*;

#[event]
pub struct ProtocolInitialized {
    pub admin: Pubkey,
    pub protocol_config: Pubkey,
    pub relayer_authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub merkle_tree: Pubkey,
    pub kyc_authority: Pubkey,
    pub oracle_max_age: u64,
    pub kamino_enabled: bool,
    pub timestamp: i64,
}

#[event]
pub struct OracleMaxAgeUpdated {
    pub admin: Pubkey,
    pub protocol_config: Pubkey,
    pub oracle_max_age: u64,
    pub timestamp: i64,
}

#[event]
pub struct KaminoModeUpdated {
    pub admin: Pubkey,
    pub protocol_config: Pubkey,
    pub kamino_enabled: bool,
    pub timestamp: i64,
}

#[event]
pub struct UserInitialized {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ReferralInitialized {
    pub referrer: Pubkey,
    pub referral_config: Pubkey,
    pub fee_bps: u16,
    pub timestamp: i64,
}

#[event]
pub struct UsdcReceived {
    pub user: Pubkey,
    pub amount: u64,
    pub sender_note: String,
    pub running_total: u64,
    pub timestamp: i64,
}

#[event]
pub struct OfframpRequested {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub usdc_amount: u64,
    pub inr_paise: u64,
    pub receipt_id: u32,
    pub destination_upi_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct CircuitBreakerTripped {
    pub triggered_by: Pubkey,
    pub attempted_amount: u64,
    pub window_outflow_before: u64,
    pub at_timestamp: i64,
}

#[event]
pub struct CircuitBreakerReset {
    pub reset_by: Pubkey,
    pub previous_trip_count: u64,
    pub at_timestamp: i64,
}
