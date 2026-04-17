use anchor_lang::prelude::*;

use crate::{
    errors::RailPayError,
    state::{CircuitBreaker, ProtocolConfig},
    CIRCUIT_BREAKER_SEED,
    PROTOCOL_CONFIG_SEED,
};

#[derive(Accounts)]
pub struct InitializeCircuitBreaker<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        init,
        payer = admin,
        space = CircuitBreaker::LEN,
        seeds = [CIRCUIT_BREAKER_SEED],
        bump,
    )]
    pub circuit_breaker: Account<'info, CircuitBreaker>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeCircuitBreaker>) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.protocol_config.admin,
        RailPayError::Unauthorized
    );

    let breaker = &mut ctx.accounts.circuit_breaker;
    breaker.authority = ctx.accounts.admin.key();
    breaker.max_outflow_per_window = 10_000_000_000;
    breaker.window_duration_seconds = 3_600;
    breaker.window_start = Clock::get()?.unix_timestamp;
    breaker.outflow_this_window = 0;
    breaker.is_tripped = false;
    breaker.trip_count = 0;
    breaker.bump = ctx.bumps.circuit_breaker;

    Ok(())
}
