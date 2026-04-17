use anchor_lang::prelude::*;

use crate::{
    errors::RailPayError,
    events::CircuitBreakerReset,
    state::{CircuitBreaker, ProtocolConfig},
    CIRCUIT_BREAKER_SEED,
    PROTOCOL_CONFIG_SEED,
};

#[derive(Accounts)]
pub struct AdminResetCircuitBreaker<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        mut,
        seeds = [CIRCUIT_BREAKER_SEED],
        bump = circuit_breaker.bump,
    )]
    pub circuit_breaker: Account<'info, CircuitBreaker>,
}

pub fn handler(ctx: Context<AdminResetCircuitBreaker>) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.protocol_config.admin,
        RailPayError::Unauthorized
    );
    require!(
        ctx.accounts.circuit_breaker.authority == ctx.accounts.admin.key(),
        RailPayError::Unauthorized
    );

    let breaker = &mut ctx.accounts.circuit_breaker;
    let previous_trip_count = breaker.trip_count;
    breaker.is_tripped = false;
    breaker.outflow_this_window = 0;
    breaker.window_start = Clock::get()?.unix_timestamp;

    emit!(CircuitBreakerReset {
        reset_by: ctx.accounts.admin.key(),
        previous_trip_count,
        at_timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
