use anchor_lang::prelude::*;

#[account]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub relayer_authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub merkle_tree: Pubkey,
    pub kyc_authority: Pubkey,
    pub oracle_max_age: u64,
    pub kamino_enabled: bool,
    pub bump: u8,
}

impl ProtocolConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 32 + 32 + 8 + 1 + 1;
    pub const LEN: usize = Self::SPACE;
}

#[account]
pub struct UserVault {
    pub owner: Pubkey,
    pub upi_handle_hash: [u8; 32],
    pub total_received: u64,
    pub total_offramped: u64,
    pub receipt_count: u32,
    pub bump: u8,
    pub is_active: bool,
}

impl UserVault {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 4 + 1 + 1;
    pub const LEN: usize = Self::SPACE;
}

#[account]
pub struct OfframpRequest {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub usdc_amount: u64,
    pub inr_paise: u64,
    pub receipt_id: u32,
    pub destination_upi_hash: [u8; 32],
    pub timestamp: i64,
    pub locked_usdc_usd_price: i64,
    pub price_expo: i32,
    pub price_locked_at: i64,
    pub price_conf: u64,
    pub bump: u8,
}

impl OfframpRequest {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 4 + 32 + 8 + 8 + 4 + 8 + 8 + 1;
    pub const LEN: usize = Self::SPACE;
}

#[account]
pub struct ReferralConfig {
    pub referrer: Pubkey,
    pub fee_bps: u16,
    pub total_earned_usdc: u64,
    pub total_referred: u64,
    pub is_active: bool,
    pub bump: u8,
}

impl ReferralConfig {
    pub const SPACE: usize = 8 + 32 + 2 + 8 + 8 + 1 + 1;
    pub const LEN: usize = Self::SPACE;
}

#[account]
pub struct CircuitBreaker {
    pub authority: Pubkey,
    pub max_outflow_per_window: u64,
    pub window_duration_seconds: i64,
    pub window_start: i64,
    pub outflow_this_window: u64,
    pub is_tripped: bool,
    pub trip_count: u64,
    pub bump: u8,
}

impl CircuitBreaker {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 8 + 8 + 1 + 8 + 1;
    pub const LEN: usize = Self::SPACE;
}
