use anchor_lang::prelude::*;

use crate::{
    errors::RailPayError,
    events::OracleMaxAgeUpdated,
    state::ProtocolConfig,
    PROTOCOL_CONFIG_SEED,
};

#[derive(Accounts)]
pub struct SetOracleMaxAge<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

pub fn handler(ctx: Context<SetOracleMaxAge>, oracle_max_age: u64) -> Result<()> {
    require!(oracle_max_age > 0, RailPayError::InvalidOracleMaxAge);
    require!(
        ctx.accounts.admin.key() == ctx.accounts.protocol_config.admin,
        RailPayError::Unauthorized
    );

    ctx.accounts.protocol_config.oracle_max_age = oracle_max_age;

    emit!(OracleMaxAgeUpdated {
        admin: ctx.accounts.admin.key(),
        protocol_config: ctx.accounts.protocol_config.key(),
        oracle_max_age,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
