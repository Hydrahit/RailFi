use anchor_lang::prelude::*;

use crate::{
    errors::RailPayError,
    state::{CircuitBreaker, ProtocolConfig},
    CIRCUIT_BREAKER_SEED,
    PROTOCOL_CONFIG_SEED,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateCircuitBreakerParams {
    pub new_max_outflow: Option<u64>,
    pub new_window_duration: Option<i64>,
}

#[derive(Accounts)]
pub struct UpdateCircuitBreakerConfig<'info> {
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

pub fn handler(
    ctx: Context<UpdateCircuitBreakerConfig>,
    params: UpdateCircuitBreakerParams,
) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.protocol_config.admin,
        RailPayError::Unauthorized
    );
    require!(
        ctx.accounts.circuit_breaker.authority == ctx.accounts.admin.key(),
        RailPayError::Unauthorized
    );

    let breaker = &mut ctx.accounts.circuit_breaker;

    if let Some(new_max_outflow) = params.new_max_outflow {
        require!(new_max_outflow > 0, RailPayError::Overflow);
        breaker.max_outflow_per_window = new_max_outflow;
    }

    if let Some(new_window_duration) = params.new_window_duration {
        require!(new_window_duration > 0, RailPayError::Overflow);
        breaker.window_duration_seconds = new_window_duration;
    }

    Ok(())
}
