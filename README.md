# Soccer Betting CosmWasm Contract

This project is now a real CosmWasm contract for pooled 1X2 soccer betting markets using a single native token denom.

## Features

- Admin-controlled market creation
- Single authorized oracle per market
- Native-token bet escrow inside the contract
- Pari-mutuel payout settlement for `HomeWin`, `Draw`, and `AwayWin`
- Treasury fee accrual in basis points
- Query endpoints for config, market state, and bettor state
- Multi-test coverage for core execution flows

## Contract Surface

- `InstantiateMsg`
  - `admin`
  - `treasury_bps`
  - `stake_denom`
- `ExecuteMsg::CreateMarket`
- `ExecuteMsg::PlaceBet`
- `ExecuteMsg::SettleMarket`
- `ExecuteMsg::CancelMarket`
- `ExecuteMsg::Claim`
- `ExecuteMsg::Refund`
- `ExecuteMsg::WithdrawFees`
- `QueryMsg::Config`
- `QueryMsg::Market`
- `QueryMsg::Bettor`

## Schema

Generate JSON schema files with:

```bash
cargo run --bin schema
```

The generated artifacts land in `schema/` and can be used by frontend clients, deployment tooling, and auditors.

## Deployment Notes

Example payloads and a deployment walkthrough live under `deployment/`.

Typical flow:

```bash
cargo test
cargo run --bin schema
cargo build --release --target wasm32-unknown-unknown
```

Then:

- store the compiled wasm on-chain
- instantiate with `deployment/instantiate.local.json`
- create markets with `deployment/create-market.example.json`
- call `place_bet`, `settle_market`, `cancel_market`, `claim`, or `refund` as needed

## Current Model

The contract uses a pari-mutuel pool per outcome. All bets for a market are escrowed in the contract. When an oracle settles the match result after kickoff:

- treasury fees are carved out
- the remaining pool becomes the winner payout pool
- each winner claims a pro-rata share
- the last winner gets any rounding remainder

If a market cannot be resolved safely, admin can cancel it:

- the market status becomes `Cancelled`
- no new bets or settlement are allowed
- each bettor can reclaim their original stake once through `Refund`

## Important Limits

This version intentionally keeps the scope narrow:

- one native staking denom only
- no DAO governance or multi-oracle consensus yet
- no odds engine, order book, or AMM pricing
- no jurisdiction/compliance layer

## Next Logical Extensions

- Add multi-oracle result attestation
- Add paginated market queries
- Add indexing-friendly events
- Add integration tests for multiple markets and fee withdrawals across markets
