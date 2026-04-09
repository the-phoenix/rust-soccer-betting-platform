use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

declare_id!("7ktmkWvLqKowac7ZUqkhdCiYVAcc3WS6h8HXVpRQ3z5u");

const STATUS_OPEN: u8 = 0;
const STATUS_SETTLED: u8 = 1;
const STATUS_CANCELLED: u8 = 2;

const OUTCOME_HOME_WIN: u8 = 0;
const OUTCOME_DRAW: u8 = 1;
const OUTCOME_AWAY_WIN: u8 = 2;

#[program]
pub mod soccer_betting_anchor {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        admin: Option<Pubkey>,
        treasury_bps: u16,
    ) -> Result<()> {
        require!(treasury_bps <= 10_000, BettingError::InvalidFeeBps);

        let config = &mut ctx.accounts.config;
        config.admin = admin.unwrap_or(ctx.accounts.payer.key());
        config.treasury_bps = treasury_bps;
        config.accrued_fees = 0;
        config.next_market_id = 1;
        config.bump = ctx.bumps.config;

        Ok(())
    }

    pub fn create_market(
        ctx: Context<CreateMarket>,
        league: String,
        home_team: String,
        away_team: String,
        kickoff_ts: i64,
        close_ts: i64,
        oracle: Pubkey,
    ) -> Result<()> {
        require_non_empty("league", &league)?;
        require_non_empty("home_team", &home_team)?;
        require_non_empty("away_team", &away_team)?;
        require!(close_ts < kickoff_ts, BettingError::InvalidSchedule);

        let config = &mut ctx.accounts.config;
        let market = &mut ctx.accounts.market;
        let market_id = config.next_market_id;

        market.id = market_id;
        market.league = league;
        market.home_team = home_team;
        market.away_team = away_team;
        market.kickoff_ts = kickoff_ts;
        market.close_ts = close_ts;
        market.oracle = oracle;
        market.status = STATUS_OPEN;
        market.settled_outcome = None;
        market.settled_at = None;
        market.total_staked = 0;
        market.total_payout_pool = 0;
        market.total_fee = 0;
        market.paid_out = 0;
        market.winning_claimed_stake = 0;
        market.pools = [0, 0, 0];
        market.bump = ctx.bumps.market;

        config.next_market_id = config
            .next_market_id
            .checked_add(1)
            .ok_or(BettingError::MathOverflow)?;

        Ok(())
    }

    pub fn place_bet(
        ctx: Context<PlaceBet>,
        market_id: u64,
        outcome: u8,
        stake_lamports: u64,
    ) -> Result<()> {
        require!(stake_lamports > 0, BettingError::ZeroAmount);

        let outcome_index = outcome_index(outcome)?;
        let now = Clock::get()?.unix_timestamp;
        let market_account_info = ctx.accounts.market.to_account_info();
        let bettor_account_info = ctx.accounts.bettor.to_account_info();
        let market = &mut ctx.accounts.market;

        require!(market.id == market_id, BettingError::MarketNotFound);
        require!(market.status == STATUS_OPEN, BettingError::BettingClosed);
        require!(now < market.close_ts, BettingError::BettingClosed);

        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: bettor_account_info,
                to: market_account_info,
            },
        );
        system_program::transfer(transfer_ctx, stake_lamports)?;

        market.total_staked = market
            .total_staked
            .checked_add(stake_lamports)
            .ok_or(BettingError::MathOverflow)?;
        market.pools[outcome_index] = market.pools[outcome_index]
            .checked_add(stake_lamports)
            .ok_or(BettingError::MathOverflow)?;

        let ledger = &mut ctx.accounts.bettor_ledger;
        if ledger.owner == Pubkey::default() {
            ledger.owner = ctx.accounts.bettor.key();
            ledger.market = ctx.accounts.market.key();
            ledger.stakes = [0, 0, 0];
            ledger.claimed = false;
            ledger.refunded = false;
            ledger.bump = ctx.bumps.bettor_ledger;
        }

        ledger.stakes[outcome_index] = ledger.stakes[outcome_index]
            .checked_add(stake_lamports)
            .ok_or(BettingError::MathOverflow)?;

        Ok(())
    }

    pub fn settle_market(ctx: Context<SettleMarket>, market_id: u64, outcome: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let market_account_info = ctx.accounts.market.to_account_info();
        let config_account_info = ctx.accounts.config.to_account_info();
        let config = &mut ctx.accounts.config;
        let market = &mut ctx.accounts.market;

        require!(market.id == market_id, BettingError::MarketNotFound);
        require!(
            market.status != STATUS_SETTLED,
            BettingError::MarketAlreadySettled
        );
        require!(
            market.status != STATUS_CANCELLED,
            BettingError::MarketAlreadyCancelled
        );
        require!(
            ctx.accounts.authority.key() == config.admin
                || ctx.accounts.authority.key() == market.oracle,
            BettingError::Unauthorized
        );
        require!(now >= market.kickoff_ts, BettingError::BetTooEarlyToSettle);

        let winning_index = outcome_index(outcome)?;
        let fee = calculate_fee(market.total_staked, config.treasury_bps)?;

        if fee > 0 {
            move_lamports(&market_account_info, &config_account_info, fee)?;
        }

        market.total_fee = fee;
        market.total_payout_pool = market
            .total_staked
            .checked_sub(fee)
            .ok_or(BettingError::MathOverflow)?;
        market.status = STATUS_SETTLED;
        market.settled_outcome = Some(winning_index as u8);
        market.settled_at = Some(now);
        config.accrued_fees = config
            .accrued_fees
            .checked_add(fee)
            .ok_or(BettingError::MathOverflow)?;

        Ok(())
    }

    pub fn cancel_market(ctx: Context<CancelMarket>, market_id: u64) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.id == market_id, BettingError::MarketNotFound);
        require!(
            market.status != STATUS_SETTLED,
            BettingError::MarketAlreadySettled
        );
        require!(
            market.status != STATUS_CANCELLED,
            BettingError::MarketAlreadyCancelled
        );

        market.status = STATUS_CANCELLED;
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>, market_id: u64) -> Result<()> {
        let market = &mut ctx.accounts.market;
        let ledger = &mut ctx.accounts.bettor_ledger;

        require!(market.id == market_id, BettingError::MarketNotFound);
        require!(market.status == STATUS_SETTLED, BettingError::BettingClosed);
        require!(!ledger.claimed, BettingError::AlreadyClaimed);

        let winning_outcome = market
            .settled_outcome
            .ok_or(BettingError::BettingClosed)?;
        let winning_index = outcome_index(winning_outcome)?;
        let winning_pool = market.pools[winning_index];
        let winning_stake = ledger.stakes[winning_index];

        require!(winning_stake > 0, BettingError::NoWinningBet);

        let payout = calculate_payout(market, winning_stake, winning_pool)?;

        ledger.claimed = true;
        market.winning_claimed_stake = market
            .winning_claimed_stake
            .checked_add(winning_stake)
            .ok_or(BettingError::MathOverflow)?;
        market.paid_out = market
            .paid_out
            .checked_add(payout)
            .ok_or(BettingError::MathOverflow)?;

        move_lamports(
            &ctx.accounts.market.to_account_info(),
            &ctx.accounts.bettor.to_account_info(),
            payout,
        )?;

        Ok(())
    }

    pub fn refund(ctx: Context<Refund>, market_id: u64) -> Result<()> {
        let market = &ctx.accounts.market;
        let ledger = &mut ctx.accounts.bettor_ledger;

        require!(market.id == market_id, BettingError::MarketNotFound);
        require!(
            market.status == STATUS_CANCELLED,
            BettingError::MarketNotCancelled
        );
        require!(!ledger.refunded, BettingError::AlreadyRefunded);

        let refund_amount = ledger
            .stakes
            .into_iter()
            .try_fold(0_u64, |acc, stake| {
                acc.checked_add(stake).ok_or(BettingError::MathOverflow)
            })?;

        require!(refund_amount > 0, BettingError::NoRefundableStake);

        ledger.refunded = true;
        move_lamports(
            &ctx.accounts.market.to_account_info(),
            &ctx.accounts.bettor.to_account_info(),
            refund_amount,
        )?;

        Ok(())
    }

    pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let amount = config.accrued_fees;

        config.accrued_fees = 0;
        if amount > 0 {
            move_lamports(
                &ctx.accounts.config.to_account_info(),
                &ctx.accounts.admin.to_account_info(),
                amount,
            )?;
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [Config::SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(
        mut,
        seeds = [Config::SEED],
        bump = config.bump,
        has_one = admin @ BettingError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = admin,
        space = 8 + Market::INIT_SPACE,
        seeds = [Market::SEED, &config.next_market_id.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct PlaceBet<'info> {
    #[account(
        seeds = [Config::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [Market::SEED, &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        init_if_needed,
        payer = bettor,
        space = 8 + BettorLedger::INIT_SPACE,
        seeds = [BettorLedger::SEED, market.key().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub bettor_ledger: Account<'info, BettorLedger>,
    #[account(mut)]
    pub bettor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct SettleMarket<'info> {
    #[account(
        mut,
        seeds = [Config::SEED],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [Market::SEED, &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct CancelMarket<'info> {
    #[account(
        seeds = [Config::SEED],
        bump = config.bump,
        has_one = admin @ BettingError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [Market::SEED, &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
    pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [Market::SEED, &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [BettorLedger::SEED, market.key().as_ref(), bettor.key().as_ref()],
        bump = bettor_ledger.bump,
        constraint = bettor_ledger.owner == bettor.key() @ BettingError::Unauthorized,
        constraint = bettor_ledger.market == market.key() @ BettingError::Unauthorized
    )]
    pub bettor_ledger: Account<'info, BettorLedger>,
    #[account(mut)]
    pub bettor: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct Refund<'info> {
    #[account(
        mut,
        seeds = [Market::SEED, &market_id.to_le_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        seeds = [BettorLedger::SEED, market.key().as_ref(), bettor.key().as_ref()],
        bump = bettor_ledger.bump,
        constraint = bettor_ledger.owner == bettor.key() @ BettingError::Unauthorized,
        constraint = bettor_ledger.market == market.key() @ BettingError::Unauthorized
    )]
    pub bettor_ledger: Account<'info, BettorLedger>,
    #[account(mut)]
    pub bettor: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(
        mut,
        seeds = [Config::SEED],
        bump = config.bump,
        has_one = admin @ BettingError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub treasury_bps: u16,
    pub accrued_fees: u64,
    pub next_market_id: u64,
    pub bump: u8,
}

impl Config {
    pub const SEED: &'static [u8] = b"config";
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub id: u64,
    #[max_len(64)]
    pub league: String,
    #[max_len(64)]
    pub home_team: String,
    #[max_len(64)]
    pub away_team: String,
    pub kickoff_ts: i64,
    pub close_ts: i64,
    pub oracle: Pubkey,
    pub status: u8,
    pub settled_outcome: Option<u8>,
    pub settled_at: Option<i64>,
    pub total_staked: u64,
    pub total_payout_pool: u64,
    pub total_fee: u64,
    pub paid_out: u64,
    pub winning_claimed_stake: u64,
    pub pools: [u64; 3],
    pub bump: u8,
}

impl Market {
    pub const SEED: &'static [u8] = b"market";
}

#[account]
#[derive(InitSpace)]
pub struct BettorLedger {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub stakes: [u64; 3],
    pub claimed: bool,
    pub refunded: bool,
    pub bump: u8,
}

impl BettorLedger {
    pub const SEED: &'static [u8] = b"bettor";
}

#[error_code]
pub enum BettingError {
    #[msg("treasury fee bps must be between 0 and 10000")]
    InvalidFeeBps,
    #[msg("betting market schedule is invalid")]
    InvalidSchedule,
    #[msg("unauthorized")]
    Unauthorized,
    #[msg("betting is closed")]
    BettingClosed,
    #[msg("market already settled")]
    MarketAlreadySettled,
    #[msg("market already cancelled")]
    MarketAlreadyCancelled,
    #[msg("market not cancelled")]
    MarketNotCancelled,
    #[msg("market not found")]
    MarketNotFound,
    #[msg("settlement attempted before kickoff")]
    BetTooEarlyToSettle,
    #[msg("amount must be positive")]
    ZeroAmount,
    #[msg("already claimed")]
    AlreadyClaimed,
    #[msg("already refunded")]
    AlreadyRefunded,
    #[msg("no winning bet")]
    NoWinningBet,
    #[msg("no refundable stake")]
    NoRefundableStake,
    #[msg("invalid outcome")]
    InvalidOutcome,
    #[msg("required text field is empty")]
    EmptyField,
    #[msg("math overflow")]
    MathOverflow,
    #[msg("insufficient vault balance")]
    InsufficientVaultBalance,
}

fn require_non_empty(_field: &'static str, value: &str) -> Result<()> {
    require!(!value.trim().is_empty(), BettingError::EmptyField);
    Ok(())
}

fn outcome_index(outcome: u8) -> Result<usize> {
    match outcome {
        OUTCOME_HOME_WIN => Ok(0),
        OUTCOME_DRAW => Ok(1),
        OUTCOME_AWAY_WIN => Ok(2),
        _ => err!(BettingError::InvalidOutcome),
    }
}

fn calculate_fee(total_staked: u64, treasury_bps: u16) -> Result<u64> {
    let numerator = (total_staked as u128)
        .checked_mul(treasury_bps as u128)
        .ok_or(BettingError::MathOverflow)?;
    Ok((numerator / 10_000_u128) as u64)
}

fn calculate_payout(market: &Market, winning_stake: u64, winning_pool: u64) -> Result<u64> {
    require!(winning_pool > 0, BettingError::NoWinningBet);

    let remaining_winning_stake = market
        .pools
        .get(market.settled_outcome.unwrap_or_default() as usize)
        .copied()
        .unwrap_or_default()
        .checked_sub(market.winning_claimed_stake)
        .ok_or(BettingError::MathOverflow)?;
    let remaining_payout_pool = market
        .total_payout_pool
        .checked_sub(market.paid_out)
        .ok_or(BettingError::MathOverflow)?;

    if winning_stake == remaining_winning_stake {
        return Ok(remaining_payout_pool);
    }

    let payout = (market.total_payout_pool as u128)
        .checked_mul(winning_stake as u128)
        .ok_or(BettingError::MathOverflow)?
        / winning_pool as u128;

    Ok(payout as u64)
}

fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }

    let mut from_lamports = from.try_borrow_mut_lamports()?;
    require!(
        **from_lamports >= amount,
        BettingError::InsufficientVaultBalance
    );
    **from_lamports = (**from_lamports)
        .checked_sub(amount)
        .ok_or(BettingError::MathOverflow)?;
    drop(from_lamports);

    let mut to_lamports = to.try_borrow_mut_lamports()?;
    **to_lamports = (**to_lamports)
        .checked_add(amount)
        .ok_or(BettingError::MathOverflow)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_market() -> Market {
        Market {
            id: 1,
            league: "Premier League".into(),
            home_team: "Arsenal".into(),
            away_team: "Liverpool".into(),
            kickoff_ts: 2_000,
            close_ts: 1_900,
            oracle: Pubkey::new_unique(),
            status: STATUS_SETTLED,
            settled_outcome: Some(OUTCOME_HOME_WIN),
            settled_at: Some(2_100),
            total_staked: 401,
            total_payout_pool: 391,
            total_fee: 10,
            paid_out: 0,
            winning_claimed_stake: 0,
            pools: [300, 101, 0],
            bump: 255,
        }
    }

    #[test]
    fn fee_calculation_matches_cosmwasm_version() {
        assert_eq!(calculate_fee(401, 250).unwrap(), 10);
        assert_eq!(calculate_fee(200, 250).unwrap(), 5);
    }

    #[test]
    fn payout_rounding_matches_expected_split() {
        let mut market = sample_market();
        let alice_payout = calculate_payout(&market, 100, 300).unwrap();
        assert_eq!(alice_payout, 130);

        market.paid_out = alice_payout;
        market.winning_claimed_stake = 100;

        let bob_payout = calculate_payout(&market, 200, 300).unwrap();
        assert_eq!(bob_payout, 261);
    }

    #[test]
    fn final_winner_gets_remaining_pool() {
        let mut market = sample_market();
        market.paid_out = 130;
        market.winning_claimed_stake = 100;

        let payout = calculate_payout(&market, 200, 300).unwrap();
        assert_eq!(payout, 261);
    }
}
