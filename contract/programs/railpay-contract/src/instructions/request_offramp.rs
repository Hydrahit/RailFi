use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::get_associated_token_address,
    token::{self, Mint, Token, TokenAccount, Transfer},
};
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};

use crate::{
    constants::usdc_usd_pyth_feed,
    errors::RailPayError,
    events::{CircuitBreakerTripped, OfframpRequested},
    mint_receipt_cnft,
    state::{CircuitBreaker, OfframpRequest, ProtocolConfig, ReferralConfig, UserVault},
    validate_upi_hash,
    BUBBLEGUM_ID,
    CIRCUIT_BREAKER_SEED,
    OFFRAMP_REQUEST_SEED,
    PROTOCOL_CONFIG_SEED,
    REFERRAL_CONFIG_SEED,
    SPL_COMPRESS_ID,
    SPL_NOOP_ID,
    USER_VAULT_SEED,
};

const PROTOCOL_FEE_BPS: u64 = 100;

#[derive(Accounts)]
pub struct TriggerOfframp<'info> {
    #[account(
        mut,
        constraint = fee_payer.key() == protocol_config.relayer_authority
            @ RailPayError::InvalidRelayerAuthority
    )]
    pub fee_payer: Signer<'info>,

    #[account(mut)]
    pub kyc_authority: Signer<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

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

    /// CHECK: Pubkey validated against the canonical Pyth USDC/USD account before deserialization.
    pub usdc_usd_price_update: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [USER_VAULT_SEED, user.key().as_ref()],
        bump  = user_vault.bump,
        constraint = user_vault.owner == user.key() @ RailPayError::UnauthorizedAccess,
        constraint = user_vault.is_active @ RailPayError::VaultInactive,
    )]
    pub user_vault: Account<'info, UserVault>,

    #[account(
        init,
        payer = fee_payer,
        space = OfframpRequest::SPACE,
        seeds = [OFFRAMP_REQUEST_SEED, user_vault.key().as_ref(), &user_vault.receipt_count.to_le_bytes()],
        bump,
    )]
    pub offramp_request: Account<'info, OfframpRequest>,

    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = user_vault
    )]
    pub vault_usdc_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub protocol_treasury_ata: Account<'info, TokenAccount>,

    #[account(
        address = protocol_config.usdc_mint @ RailPayError::InvalidUsdcMint
    )]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        mut,
        address = protocol_config.merkle_tree @ RailPayError::InvalidMerkleTree
    )]
    /// CHECK: Merkle tree address is pinned in ProtocolConfig and only forwarded into Bubblegum.
    pub merkle_tree: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [merkle_tree.key().as_ref()],
        bump,
        seeds::program = bubblegum_program.key(),
    )]
    /// CHECK: Bubblegum validates the tree_config PDA from the merkle tree seed tuple.
    pub tree_config: UncheckedAccount<'info>,

    #[account(address = BUBBLEGUM_ID.parse::<Pubkey>().unwrap())]
    /// CHECK: Address constrained to the canonical Bubblegum program ID.
    pub bubblegum_program: UncheckedAccount<'info>,

    #[account(address = SPL_NOOP_ID.parse::<Pubkey>().unwrap())]
    /// CHECK: Address constrained to the canonical SPL Noop program ID.
    pub log_wrapper: UncheckedAccount<'info>,

    #[account(address = SPL_COMPRESS_ID.parse::<Pubkey>().unwrap())]
    /// CHECK: Address constrained to the canonical SPL Account Compression program ID.
    pub compression_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, TriggerOfframp<'info>>,
    amount: u64,
    destination_upi_hash: [u8; 32],
    inr_paise: u64,
) -> Result<()> {
    require!(
        ctx.accounts.kyc_authority.is_signer,
        RailPayError::MissingKycAuthorization
    );
    require!(
        ctx.accounts.kyc_authority.key() == ctx.accounts.protocol_config.kyc_authority,
        RailPayError::InvalidKycAuthority
    );

    require!(
        !ctx.accounts.circuit_breaker.is_tripped,
        RailPayError::CircuitBreakerTripped
    );

    let referral_state = if ctx.remaining_accounts.is_empty() {
        None
    } else {
        require!(
            ctx.remaining_accounts.len() == 2,
            RailPayError::InvalidReferralAccounts
        );
        require!(
            ctx.remaining_accounts[0].is_writable && ctx.remaining_accounts[1].is_writable,
            RailPayError::InvalidReferralAccounts
        );

        let referral_config = Account::<ReferralConfig>::try_from(&ctx.remaining_accounts[0])?;
        require!(referral_config.is_active, RailPayError::InactiveReferral);
        require_keys_neq!(
            referral_config.referrer,
            ctx.accounts.user.key(),
            RailPayError::SelfReferralNotAllowed
        );

        let expected_referral_config = Pubkey::find_program_address(
            &[REFERRAL_CONFIG_SEED, referral_config.referrer.as_ref()],
            &crate::ID,
        )
        .0;
        require!(
            ctx.remaining_accounts[0].key() == expected_referral_config,
            RailPayError::InvalidReferralAccounts
        );

        let referrer_usdc_account = Account::<TokenAccount>::try_from(&ctx.remaining_accounts[1])?;
        require!(
            referrer_usdc_account.owner == referral_config.referrer,
            RailPayError::InvalidReferrerTokenAccount
        );
        require!(
            referrer_usdc_account.mint == ctx.accounts.usdc_mint.key(),
            RailPayError::InvalidReferrerTokenAccount
        );

        Some(ReferralState {
            referral_config,
            referrer_usdc_account,
        })
    };

    let protocol_fee = amount
        .checked_mul(PROTOCOL_FEE_BPS)
        .and_then(|value| value.checked_div(10_000))
        .ok_or(RailPayError::MathOverflow)?;
    let referral_fee = if let Some(referral_config) = referral_state.as_ref().map(|state| &state.referral_config) {
        protocol_fee
            .checked_mul(referral_config.fee_bps as u64)
            .and_then(|value| value.checked_div(10_000))
            .ok_or(RailPayError::MathOverflow)?
    } else {
        0
    };
    let total_deducted = amount
        .checked_add(protocol_fee)
        .and_then(|value| value.checked_add(referral_fee))
        .ok_or(RailPayError::MathOverflow)?;

    let now = Clock::get()?.unix_timestamp;
    let cb = &mut ctx.accounts.circuit_breaker;

    if now.saturating_sub(cb.window_start) >= cb.window_duration_seconds {
        cb.window_start = now;
        cb.outflow_this_window = 0;
    }

    let new_outflow = cb
        .outflow_this_window
        .checked_add(total_deducted)
        .ok_or(RailPayError::Overflow)?;

    if new_outflow > cb.max_outflow_per_window {
        cb.is_tripped = true;
        cb.trip_count = cb.trip_count.saturating_add(1);

        emit!(CircuitBreakerTripped {
            triggered_by: ctx.accounts.user.key(),
            attempted_amount: amount,
            window_outflow_before: cb.outflow_this_window,
            at_timestamp: now,
        });

        return Err(RailPayError::CircuitBreakerTripped.into());
    }

    cb.outflow_this_window = new_outflow;

    require!(
        ctx.accounts.usdc_usd_price_update.key() == usdc_usd_pyth_feed(),
        RailPayError::WrongPriceFeedAccount
    );

    let price_update_data = ctx.accounts.usdc_usd_price_update.data.borrow();
    let mut price_update_slice: &[u8] = &price_update_data;
    let price_update = PriceUpdateV2::try_deserialize(&mut price_update_slice)
        .map_err(|_| RailPayError::StalePriceFeed)?;

    let oracle_clock = Clock::get()?;
    let feed_id = get_feed_id_from_hex(
        "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    )
    .map_err(|_| RailPayError::WrongPriceFeedAccount)?;

    let price = price_update
        .get_price_no_older_than(
            &oracle_clock,
            ctx.accounts.protocol_config.oracle_max_age,
            &feed_id,
        )
        .map_err(|_| RailPayError::StalePriceFeed)?;

    require!(
        (price.conf as u128).saturating_mul(200) < (price.price.unsigned_abs() as u128),
        RailPayError::PriceConfidenceTooWide
    );

    require!(amount >= 10_000, RailPayError::AmountTooSmall);
    validate_upi_hash(&destination_upi_hash)?;

    let vault_key = ctx.accounts.user_vault.key();
    let vault_bump = ctx.accounts.user_vault.bump;
    let vault = &mut ctx.accounts.user_vault;
    let escrow_balance = ctx.accounts.vault_usdc_account.amount;
    let reconciled_total_received = vault
        .total_offramped
        .checked_add(escrow_balance)
        .ok_or(RailPayError::MathOverflow)?;

    if reconciled_total_received > vault.total_received {
        vault.total_received = reconciled_total_received;
    }

    let available = vault
        .total_received
        .checked_sub(vault.total_offramped)
        .ok_or(RailPayError::MathOverflow)?;

    require!(available >= total_deducted, RailPayError::InsufficientBalance);
    require!(
        escrow_balance >= total_deducted,
        RailPayError::InsufficientEscrowBalance
    );
    let expected_protocol_treasury_ata = get_associated_token_address(
        &ctx.accounts.protocol_config.key(),
        &ctx.accounts.usdc_mint.key(),
    );
    require_keys_eq!(
        ctx.accounts.protocol_treasury_ata.key(),
        expected_protocol_treasury_ata,
        RailPayError::InvalidProtocolTreasuryAccount
    );
    require!(
        ctx.accounts.protocol_treasury_ata.owner == ctx.accounts.protocol_config.key(),
        RailPayError::InvalidProtocolTreasuryAccount
    );
    require!(
        ctx.accounts.protocol_treasury_ata.mint == ctx.accounts.usdc_mint.key(),
        RailPayError::InvalidProtocolTreasuryAccount
    );

    if ctx.accounts.protocol_config.kamino_enabled {
        msg!("Kamino benchmark mode active - on-chain yield CPIs are stubbed in this MVP.");
    }

    vault.total_offramped = vault
        .total_offramped
        .checked_add(total_deducted)
        .ok_or(RailPayError::MathOverflow)?;

    let receipt_id = vault.receipt_count;
    vault.receipt_count = vault
        .receipt_count
        .checked_add(1)
        .ok_or(RailPayError::MathOverflow)?;
    let user_key = ctx.accounts.user.key();
    let protocol_key = ctx.accounts.protocol_config.key();
    let protocol_bump = ctx.accounts.protocol_config.bump;

    let offramp_request = &mut ctx.accounts.offramp_request;
    offramp_request.user = user_key;
    offramp_request.vault = vault_key;
    offramp_request.usdc_amount = amount;
    offramp_request.inr_paise = inr_paise;
    offramp_request.receipt_id = receipt_id;
    offramp_request.destination_upi_hash = destination_upi_hash;
    offramp_request.timestamp = oracle_clock.unix_timestamp;
    offramp_request.locked_usdc_usd_price = price.price;
    offramp_request.price_expo = price.exponent;
    offramp_request.price_locked_at = oracle_clock.unix_timestamp;
    offramp_request.price_conf = price.conf;
    offramp_request.bump = ctx.bumps.offramp_request;

    let user_key_bytes = user_key.to_bytes();
    let signer_seed_slice: [&[u8]; 3] = [USER_VAULT_SEED, user_key_bytes.as_ref(), &[vault_bump]];
    let signer_seeds: &[&[&[u8]]] = &[&signer_seed_slice];

    if protocol_fee > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_usdc_account.to_account_info(),
                    to: ctx.accounts.protocol_treasury_ata.to_account_info(),
                    authority: ctx.accounts.user_vault.to_account_info(),
                },
                signer_seeds,
            ),
            protocol_fee,
        )?;
    }

    if let Some(mut referral_state) = referral_state {
        if referral_fee > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault_usdc_account.to_account_info(),
                        to: referral_state.referrer_usdc_account.to_account_info(),
                        authority: ctx.accounts.user_vault.to_account_info(),
                    },
                    signer_seeds,
                ),
                referral_fee,
            )?;
        }

        referral_state.referral_config.total_earned_usdc = referral_state
            .referral_config
            .total_earned_usdc
            .checked_add(referral_fee)
            .ok_or(RailPayError::MathOverflow)?;
        referral_state.referral_config.total_referred = referral_state
            .referral_config
            .total_referred
            .checked_add(1)
            .ok_or(RailPayError::MathOverflow)?;
    }

    emit!(OfframpRequested {
        user: user_key,
        vault: vault_key,
        usdc_amount: amount,
        inr_paise,
        receipt_id,
        destination_upi_hash,
        timestamp: oracle_clock.unix_timestamp,
    });

    mint_receipt_cnft(
        &ctx.accounts.bubblegum_program.to_account_info(),
        &ctx.accounts.tree_config.to_account_info(),
        &ctx.accounts.user.to_account_info(),
        &ctx.accounts.merkle_tree.to_account_info(),
        &ctx.accounts.protocol_config.to_account_info(),
        &ctx.accounts.log_wrapper.to_account_info(),
        &ctx.accounts.compression_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        receipt_id,
        vault_key,
        protocol_key,
        user_key,
        ctx.accounts.offramp_request.key(),
        protocol_bump,
    )?;

    msg!(
        "cNFT receipt #{} minted | {} micro-USDC | locked usdc/usd mantissa {} expo {}",
        receipt_id,
        amount,
        price.price,
        price.exponent,
    );

    Ok(())
}

struct ReferralState<'info> {
    referral_config: Account<'info, ReferralConfig>,
    referrer_usdc_account: Account<'info, TokenAccount>,
}








