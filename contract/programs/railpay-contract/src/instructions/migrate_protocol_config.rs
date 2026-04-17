use std::io::Cursor;

use anchor_lang::{prelude::*, system_program, Discriminator};

use crate::{
    errors::RailPayError,
    events::OracleMaxAgeUpdated,
    state::ProtocolConfig,
    PROTOCOL_CONFIG_SEED,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
struct LegacyProtocolConfigData {
    admin: Pubkey,
    usdc_mint: Pubkey,
    merkle_tree: Pubkey,
    kyc_authority: Pubkey,
    kamino_enabled: bool,
    bump: u8,
}

impl LegacyProtocolConfigData {
    const LEN: usize = 8 + 32 + 32 + 32 + 32 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
struct CurrentProtocolConfigData {
    admin: Pubkey,
    relayer_authority: Pubkey,
    usdc_mint: Pubkey,
    merkle_tree: Pubkey,
    kyc_authority: Pubkey,
    oracle_max_age: u64,
    kamino_enabled: bool,
    bump: u8,
}

impl CurrentProtocolConfigData {
    const LEN: usize = 8 + 32 + 32 + 32 + 32 + 32 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
struct OracleAwareProtocolConfigData {
    admin: Pubkey,
    usdc_mint: Pubkey,
    merkle_tree: Pubkey,
    kyc_authority: Pubkey,
    oracle_max_age: u64,
    kamino_enabled: bool,
    bump: u8,
}

impl OracleAwareProtocolConfigData {
    const LEN: usize = 8 + 32 + 32 + 32 + 32 + 8 + 1 + 1;
}

#[derive(Accounts)]
pub struct MigrateProtocolConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Seed, owner, discriminator, and serialized layout are validated manually.
    #[account(
        mut,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump,
    )]
    pub protocol_config: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

fn ensure_protocol_config_discriminator(data: &[u8]) -> Result<()> {
    require!(
        data.len() >= 8 && data[..8] == ProtocolConfig::DISCRIMINATOR,
        RailPayError::InvalidProtocolConfigAccount
    );
    Ok(())
}

fn deserialize_legacy(data: &[u8]) -> Result<LegacyProtocolConfigData> {
    ensure_protocol_config_discriminator(data)?;
    let mut slice: &[u8] = &data[8..];
    LegacyProtocolConfigData::deserialize(&mut slice)
        .map_err(|_| error!(RailPayError::InvalidProtocolConfigAccount))
}

fn deserialize_current(data: &[u8]) -> Result<CurrentProtocolConfigData> {
    ensure_protocol_config_discriminator(data)?;
    let mut slice: &[u8] = &data[8..];
    CurrentProtocolConfigData::deserialize(&mut slice)
        .map_err(|_| error!(RailPayError::InvalidProtocolConfigAccount))
}

fn deserialize_oracle_aware(data: &[u8]) -> Result<OracleAwareProtocolConfigData> {
    ensure_protocol_config_discriminator(data)?;
    let mut slice: &[u8] = &data[8..];
    OracleAwareProtocolConfigData::deserialize(&mut slice)
        .map_err(|_| error!(RailPayError::InvalidProtocolConfigAccount))
}

fn serialize_current(account_info: &AccountInfo<'_>, config: &CurrentProtocolConfigData) -> Result<()> {
    let mut data = account_info.try_borrow_mut_data()?;
    data.fill(0);
    data[..8].copy_from_slice(&ProtocolConfig::DISCRIMINATOR);
    let mut cursor = Cursor::new(&mut data[8..]);
    config
        .serialize(&mut cursor)
        .map_err(|_| error!(RailPayError::SerializationError))?;
    Ok(())
}

pub fn handler(
    ctx: Context<MigrateProtocolConfig>,
    relayer_authority: Pubkey,
    oracle_max_age: u64,
) -> Result<()> {
    require!(oracle_max_age > 0, RailPayError::InvalidOracleMaxAge);

    let protocol_config_info = ctx.accounts.protocol_config.to_account_info();
    require!(
        *protocol_config_info.owner == crate::ID,
        RailPayError::InvalidProtocolConfigAccount
    );

    let current_len = protocol_config_info.data_len();
    let upgraded = {
        let data = protocol_config_info.try_borrow_data()?;

        if current_len == LegacyProtocolConfigData::LEN {
            let legacy = deserialize_legacy(&data)?;
            require!(
                legacy.admin == ctx.accounts.admin.key(),
                RailPayError::Unauthorized
            );

            CurrentProtocolConfigData {
                admin: legacy.admin,
                relayer_authority,
                usdc_mint: legacy.usdc_mint,
                merkle_tree: legacy.merkle_tree,
                kyc_authority: legacy.kyc_authority,
                oracle_max_age,
                kamino_enabled: legacy.kamino_enabled,
                bump: legacy.bump,
            }
        } else if current_len == OracleAwareProtocolConfigData::LEN {
            let current = deserialize_oracle_aware(&data)?;
            require!(
                current.admin == ctx.accounts.admin.key(),
                RailPayError::Unauthorized
            );

            CurrentProtocolConfigData {
                admin: current.admin,
                relayer_authority,
                usdc_mint: current.usdc_mint,
                merkle_tree: current.merkle_tree,
                kyc_authority: current.kyc_authority,
                oracle_max_age,
                kamino_enabled: current.kamino_enabled,
                bump: current.bump,
            }
        } else if current_len >= CurrentProtocolConfigData::LEN {
            let current = deserialize_current(&data)?;
            require!(
                current.admin == ctx.accounts.admin.key(),
                RailPayError::Unauthorized
            );

            CurrentProtocolConfigData {
                relayer_authority,
                oracle_max_age,
                ..current
            }
        } else {
            return Err(error!(RailPayError::InvalidProtocolConfigAccount));
        }
    };

    if current_len < ProtocolConfig::SPACE {
        let rent = Rent::get()?;
        let required_lamports = rent
            .minimum_balance(ProtocolConfig::SPACE)
            .saturating_sub(protocol_config_info.lamports());

        if required_lamports > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.admin.to_account_info(),
                        to: protocol_config_info.clone(),
                    },
                ),
                required_lamports,
            )?;
        }

        protocol_config_info.realloc(ProtocolConfig::SPACE, false)?;
    }

    serialize_current(&protocol_config_info, &upgraded)?;

    emit!(OracleMaxAgeUpdated {
        admin: ctx.accounts.admin.key(),
        protocol_config: protocol_config_info.key(),
        oracle_max_age,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
