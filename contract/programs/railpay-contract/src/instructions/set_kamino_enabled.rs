use anchor_lang::prelude::*;

use crate::{
    errors::RailPayError,
    events::KaminoModeUpdated,
    state::ProtocolConfig,
    PROTOCOL_CONFIG_SEED,
};

#[derive(Accounts)]
pub struct SetKaminoEnabled<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

pub fn handler(ctx: Context<SetKaminoEnabled>, enabled: bool) -> Result<()> {
    require!(
        ctx.accounts.admin.key() == ctx.accounts.protocol_config.admin,
        RailPayError::Unauthorized
    );

    ctx.accounts.protocol_config.kamino_enabled = enabled;

    emit!(KaminoModeUpdated {
        admin: ctx.accounts.admin.key(),
        protocol_config: ctx.accounts.protocol_config.key(),
        kamino_enabled: enabled,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
