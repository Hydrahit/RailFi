use anchor_lang::prelude::*;

use crate::{
    errors::RailPayError,
    events::ReferralInitialized,
    state::ReferralConfig,
    REFERRAL_CONFIG_SEED,
};

#[derive(Accounts)]
pub struct InitializeReferral<'info> {
    #[account(mut)]
    pub referrer: Signer<'info>,

    #[account(
        init,
        payer = referrer,
        space = ReferralConfig::SPACE,
        seeds = [REFERRAL_CONFIG_SEED, referrer.key().as_ref()],
        bump,
    )]
    pub referral_config: Account<'info, ReferralConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeReferral>, fee_bps: u16) -> Result<()> {
    require!(
        (1..=5_000).contains(&fee_bps),
        RailPayError::InvalidFeeBps
    );

    let referral_config_key = ctx.accounts.referral_config.key();
    let referral_config = &mut ctx.accounts.referral_config;
    referral_config.referrer = ctx.accounts.referrer.key();
    referral_config.fee_bps = fee_bps;
    referral_config.total_earned_usdc = 0;
    referral_config.total_referred = 0;
    referral_config.is_active = true;
    referral_config.bump = ctx.bumps.referral_config;

    emit!(ReferralInitialized {
        referrer: referral_config.referrer,
        referral_config: referral_config_key,
        fee_bps,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
