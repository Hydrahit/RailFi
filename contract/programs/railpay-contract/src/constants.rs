use anchor_lang::prelude::Pubkey;
use std::str::FromStr;

/// USDC/USD Pyth price feed account on Solana Devnet.
/// Source: https://docs.pyth.network/price-feeds/core/push-feeds/solana
/// This is the PriceUpdateV2 account written by the Pyth Wormhole receiver program.
pub fn usdc_usd_pyth_feed() -> Pubkey {
    Pubkey::from_str("5SSkXsEKQepjZLouepNSkHLuWcjFmdCPmZKK9T1AxgGA").unwrap()
}

// NOTE: USD/INR is NOT available as a live Devnet Solana account.
// INR conversion is handled on the frontend via Hermes streaming API.
// The on-chain program only locks the USDC/USD rate, and staleness is configured
// by the admin in ProtocolConfig.oracle_max_age.
