use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    bpf_loader_upgradeable::{self, UpgradeableLoaderState},
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

pub mod errors;
pub mod events;
pub mod instructions;
pub mod constants;
pub mod state;

use errors::RailpayError;
use events::*;
pub use instructions::admin_reset_circuit_breaker::AdminResetCircuitBreaker;
pub use instructions::initialize_circuit_breaker::InitializeCircuitBreaker;
pub use instructions::initialize_referral::InitializeReferral;
pub use instructions::migrate_protocol_config::MigrateProtocolConfig;
pub use instructions::request_offramp::TriggerOfframp;
pub use instructions::set_oracle_max_age::SetOracleMaxAge;
pub use instructions::set_kamino_enabled::SetKaminoEnabled;
pub use instructions::update_circuit_breaker_config::{
    UpdateCircuitBreakerConfig, UpdateCircuitBreakerParams,
};
use instructions::admin_reset_circuit_breaker::__client_accounts_admin_reset_circuit_breaker;
use instructions::initialize_circuit_breaker::__client_accounts_initialize_circuit_breaker;
use instructions::initialize_referral::__client_accounts_initialize_referral;
use instructions::migrate_protocol_config::__client_accounts_migrate_protocol_config;
use instructions::request_offramp::__client_accounts_trigger_offramp;
use instructions::set_oracle_max_age::__client_accounts_set_oracle_max_age;
use instructions::set_kamino_enabled::__client_accounts_set_kamino_enabled;
use instructions::update_circuit_breaker_config::__client_accounts_update_circuit_breaker_config;
use state::{ProtocolConfig, ReferralConfig, UserVault};

declare_id!("EfjBUSFyCMEVkcbc66Dzj94qRrYcC9ojKrmdWqk4Thin");

pub const USER_VAULT_SEED: &[u8] = b"user_vault";
pub const PROTOCOL_CONFIG_SEED: &[u8] = b"protocol_config_v2";
pub const CIRCUIT_BREAKER_SEED: &[u8] = b"circuit_breaker";
pub const OFFRAMP_REQUEST_SEED: &[u8] = b"offramp_request";
pub const REFERRAL_CONFIG_SEED: &[u8] = b"referral_config";
pub const MOCK_USD_INR_RATE: u64 = 8350;

pub const BUBBLEGUM_ID: &str = "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";
pub const SPL_NOOP_ID: &str = "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV";
pub const SPL_COMPRESS_ID: &str = "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK";

#[derive(AnchorSerialize)]
struct CnftCreator {
    address: [u8; 32],
    verified: bool,
    share: u8,
}

#[derive(AnchorSerialize)]
struct CnftCollection {
    verified: bool,
    key: [u8; 32],
}

#[derive(AnchorSerialize)]
#[allow(dead_code)]
struct CnftUses {
    use_method: u8,
    remaining: u64,
    total: u64,
}

#[derive(AnchorSerialize)]
struct CnftMetadataArgs {
    name: String,
    symbol: String,
    uri: String,
    seller_fee_basis_points: u16,
    primary_sale_happened: bool,
    is_mutable: bool,
    edition_nonce: Option<u8>,
    token_standard: Option<u8>,
    collection: Option<CnftCollection>,
    uses: Option<CnftUses>,
    token_program_version: u8,
    creators: Vec<CnftCreator>,
}

#[program]
pub mod railpay_contract {
    use super::*;

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        relayer_authority: Pubkey,
        kyc_authority: Pubkey,
        kamino_enabled: bool,
        oracle_max_age: u64,
    ) -> Result<()> {
        require!(oracle_max_age > 0, crate::errors::RailPayError::InvalidOracleMaxAge);
        let expected_program_data = ctx
            .accounts
            .railpay_program
            .programdata_address()?
            .ok_or(error!(RailpayError::Unauthorized))?;
        require_keys_eq!(
            expected_program_data,
            ctx.accounts.program_data.key(),
            RailpayError::Unauthorized
        );
        require_keys_eq!(
            *ctx.accounts.program_data.owner,
            bpf_loader_upgradeable::id(),
            RailpayError::Unauthorized
        );

        let program_data_state: UpgradeableLoaderState = bincode::deserialize(
            &ctx.accounts.program_data.try_borrow_data()?,
        )
        .map_err(|_| error!(RailpayError::Unauthorized))?;

        let upgrade_authority = match program_data_state {
            UpgradeableLoaderState::ProgramData {
                upgrade_authority_address,
                ..
            } => upgrade_authority_address,
            _ => return err!(RailpayError::Unauthorized),
        };

        require!(
            upgrade_authority == Some(ctx.accounts.admin.key()),
            RailpayError::Unauthorized
        );

        let protocol_config_key = ctx.accounts.protocol_config.key();
        let protocol = &mut ctx.accounts.protocol_config;
        protocol.admin = ctx.accounts.admin.key();
        protocol.relayer_authority = relayer_authority;
        protocol.usdc_mint = ctx.accounts.usdc_mint.key();
        protocol.merkle_tree = ctx.accounts.merkle_tree.key();
        protocol.kyc_authority = kyc_authority;
        protocol.oracle_max_age = oracle_max_age;
        protocol.kamino_enabled = kamino_enabled;
        protocol.bump = ctx.bumps.protocol_config;

        emit!(ProtocolInitialized {
            admin: protocol.admin,
            protocol_config: protocol_config_key,
            relayer_authority: protocol.relayer_authority,
            usdc_mint: protocol.usdc_mint,
            merkle_tree: protocol.merkle_tree,
            kyc_authority: protocol.kyc_authority,
            oracle_max_age: protocol.oracle_max_age,
            kamino_enabled: protocol.kamino_enabled,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn initialize_user(ctx: Context<InitializeUser>, upi_handle_hash: [u8; 32]) -> Result<()> {
        validate_upi_hash(&upi_handle_hash)?;

        let vault = &mut ctx.accounts.user_vault;
        vault.owner = ctx.accounts.user.key();
        vault.upi_handle_hash = upi_handle_hash;
        vault.total_received = 0;
        vault.total_offramped = 0;
        vault.receipt_count = 0;
        vault.is_active = true;
        vault.bump = ctx.bumps.user_vault;

        emit!(UserInitialized {
            user: ctx.accounts.user.key(),
            vault: ctx.accounts.user_vault.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn receive_usdc(
        ctx: Context<ReceiveUsdc>,
        amount: u64,
        sender_note: String,
    ) -> Result<()> {
        require!(amount >= 10_000, RailpayError::AmountTooSmall);
        require!(sender_note.len() <= 100, RailpayError::NoteTooLong);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_usdc_account.to_account_info(),
                    to: ctx.accounts.vault_usdc_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        if ctx.accounts.protocol_config.kamino_enabled {
            // Safe yield toggle hook: when Kamino CPI integration is ready for this Anchor/Solana toolchain,
            // vault deposits can be routed into Kamino here. Devnet keeps the canonical SPL vault ATA path.
            msg!("Kamino benchmark mode active - deposit remains in the standard vault ATA.");
        }

        let vault = &mut ctx.accounts.user_vault;
        vault.total_received = vault
            .total_received
            .checked_add(amount)
            .ok_or(RailpayError::MathOverflow)?;

        emit!(UsdcReceived {
            user: ctx.accounts.user.key(),
            amount,
            sender_note,
            running_total: vault.total_received,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn trigger_offramp<'info>(
        ctx: Context<'_, '_, 'info, 'info, TriggerOfframp<'info>>,
        usdc_amount: u64,
        destination_upi_hash: [u8; 32],
        inr_paise: u64,
    ) -> Result<()> {
        instructions::request_offramp::handler(ctx, usdc_amount, destination_upi_hash, inr_paise)
    }

    pub fn initialize_circuit_breaker(
        ctx: Context<InitializeCircuitBreaker>,
    ) -> Result<()> {
        instructions::initialize_circuit_breaker::handler(ctx)
    }

    pub fn initialize_referral(
        ctx: Context<InitializeReferral>,
        fee_bps: u16,
    ) -> Result<()> {
        instructions::initialize_referral::handler(ctx, fee_bps)
    }

    pub fn migrate_protocol_config(
        ctx: Context<MigrateProtocolConfig>,
        relayer_authority: Pubkey,
        oracle_max_age: u64,
    ) -> Result<()> {
        instructions::migrate_protocol_config::handler(ctx, relayer_authority, oracle_max_age)
    }

    pub fn admin_reset_circuit_breaker(
        ctx: Context<AdminResetCircuitBreaker>,
    ) -> Result<()> {
        instructions::admin_reset_circuit_breaker::handler(ctx)
    }

    pub fn update_circuit_breaker_config(
        ctx: Context<UpdateCircuitBreakerConfig>,
        params: UpdateCircuitBreakerParams,
    ) -> Result<()> {
        instructions::update_circuit_breaker_config::handler(ctx, params)
    }

    pub fn set_kamino_enabled(
        ctx: Context<SetKaminoEnabled>,
        enabled: bool,
    ) -> Result<()> {
        instructions::set_kamino_enabled::handler(ctx, enabled)
    }

    pub fn set_oracle_max_age(
        ctx: Context<SetOracleMaxAge>,
        oracle_max_age: u64,
    ) -> Result<()> {
        instructions::set_oracle_max_age::handler(ctx, oracle_max_age)
    }
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        constraint = railpay_program.programdata_address()? == Some(program_data.key())
            @ RailpayError::Unauthorized
    )]
    pub railpay_program: Program<'info, crate::program::RailpayContract>,

    /// CHECK: validated in handler against the upgradeable loader ProgramData state.
    pub program_data: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        space = ProtocolConfig::SPACE,
        seeds = [PROTOCOL_CONFIG_SEED],
        bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    pub usdc_mint: Account<'info, Mint>,

    /// CHECK: tree account is validated through its Bubblegum tree_config PDA
    pub merkle_tree: UncheckedAccount<'info>,

    #[account(
        seeds = [merkle_tree.key().as_ref()],
        bump,
        seeds::program = bubblegum_program.key(),
    )]
    /// CHECK: Bubblegum validates the tree_config PDA from the merkle tree seed tuple.
    pub tree_config: UncheckedAccount<'info>,

    /// CHECK: Address constrained to the canonical Bubblegum program ID.
    #[account(address = BUBBLEGUM_ID.parse::<Pubkey>().unwrap())]
    pub bubblegum_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeUser<'info> {
    #[account(mut)]
    pub fee_payer: Signer<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = fee_payer,
        space = UserVault::SPACE,
        seeds = [USER_VAULT_SEED, user.key().as_ref()],
        bump
    )]
    pub user_vault: Account<'info, UserVault>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReceiveUsdc<'info> {
    #[account(mut)]
    pub fee_payer: Signer<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [PROTOCOL_CONFIG_SEED],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        mut,
        seeds = [USER_VAULT_SEED, user.key().as_ref()],
        bump = user_vault.bump,
        constraint = user_vault.owner == user.key() @ RailpayError::UnauthorizedAccess,
        constraint = user_vault.is_active @ RailpayError::VaultInactive,
    )]
    pub user_vault: Account<'info, UserVault>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = user
    )]
    pub user_usdc_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = fee_payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = user_vault
    )]
    pub vault_usdc_account: Account<'info, TokenAccount>,

    #[account(address = protocol_config.usdc_mint @ RailpayError::InvalidUsdcMint)]
    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReadReferralConfig<'info> {
    #[account(
        seeds = [REFERRAL_CONFIG_SEED, referral_config.referrer.as_ref()],
        bump = referral_config.bump,
    )]
    pub referral_config: Account<'info, ReferralConfig>,
}

#[inline(never)]
pub fn mint_receipt_cnft<'info>(
    bubblegum_program: &AccountInfo<'info>,
    tree_config: &AccountInfo<'info>,
    leaf_owner: &AccountInfo<'info>,
    merkle_tree: &AccountInfo<'info>,
    tree_creator_or_delegate: &AccountInfo<'info>,
    log_wrapper: &AccountInfo<'info>,
    compression_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    receipt_id: u32,
    _vault_key: Pubkey,
    protocol_key: Pubkey,
    _user_key: Pubkey,
    offramp_request_key: Pubkey,
    protocol_bump: u8,
) -> Result<()> {
    let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_CONFIG_SEED, &[protocol_bump]]];

    let metadata = Box::new(CnftMetadataArgs {
        name: format!("RailPay Receipt #{}", receipt_id),
        symbol: "RPAY".to_string(),
        uri: format!(
            "https://railpay.xyz/receipt/{}?request={}",
            receipt_id, offramp_request_key
        ),
        seller_fee_basis_points: 0,
        primary_sale_happened: true,
        is_mutable: false,
        edition_nonce: None,
        token_standard: Some(0),
        collection: None,
        uses: None,
        token_program_version: 0,
        creators: vec![CnftCreator {
            address: protocol_key.to_bytes(),
            verified: true,
            share: 100,
        }],
    });

    let mut ix_data: Vec<u8> = Vec::with_capacity(512);
    ix_data.extend_from_slice(&[145u8, 98, 192, 118, 184, 147, 118, 104]);
    metadata
        .as_ref()
        .serialize(&mut ix_data)
        .map_err(|_| error!(RailpayError::SerializationError))?;

    let ix = Instruction {
        program_id: BUBBLEGUM_ID.parse::<Pubkey>().unwrap(),
        accounts: vec![
            AccountMeta::new(*tree_config.key, false),
            AccountMeta::new_readonly(*leaf_owner.key, false),
            AccountMeta::new_readonly(*leaf_owner.key, false),
            AccountMeta::new(*merkle_tree.key, false),
            AccountMeta::new(*leaf_owner.key, true),
            AccountMeta::new_readonly(*tree_creator_or_delegate.key, true),
            AccountMeta::new_readonly(*log_wrapper.key, false),
            AccountMeta::new_readonly(*compression_program.key, false),
            AccountMeta::new_readonly(*system_program.key, false),
        ],
        data: ix_data,
    };

    invoke_signed(
        &ix,
        &[
            bubblegum_program.clone(),
            tree_config.clone(),
            leaf_owner.clone(),
            leaf_owner.clone(),
            merkle_tree.clone(),
            leaf_owner.clone(),
            tree_creator_or_delegate.clone(),
            log_wrapper.clone(),
            compression_program.clone(),
            system_program.clone(),
        ],
        signer_seeds,
    )
    .map_err(|error| {
        msg!("Bubblegum mint_v1 CPI failed: {:?}", error);
        error!(RailpayError::CpiError)
    })?;

    Ok(())
}

pub fn validate_upi_hash(upi_handle_hash: &[u8; 32]) -> Result<()> {
    require!(
        *upi_handle_hash != [0u8; 32],
        RailpayError::InvalidUpiHash
    );
    Ok(())
}

