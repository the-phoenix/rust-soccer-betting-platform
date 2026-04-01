# Deployment Guide

This folder contains example payloads for local or testnet deployment of the soccer betting CosmWasm contract.

## Build

```bash
cargo test
cargo run --bin schema
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
```

Compiled wasm path:

```text
target/wasm32-unknown-unknown/release/soccer_betting_contract.wasm
```

## Scripted Deploy

Use the helper script in `scripts/deploy.sh`:

```bash
cp deployment/env.example .env.deploy
source .env.deploy
bash scripts/deploy.sh
```

Required environment variables:

- `CHAIN_CLI`
- `CHAIN_ID`
- `NODE`
- `FROM`
- `GAS_PRICES`

Optional environment variables:

- `WASM_PATH`
- `INIT_MSG_PATH`
- `LABEL`
- `GAS`
- `GAS_ADJUSTMENT`
- `OUTPUT_FORMAT`
- `EXTRA_TX_FLAG`

## Example Flow

1. Build the wasm and schema.
2. Export env vars or source `deployment/env.example`.
3. Run `bash scripts/deploy.sh`.
4. Create a market using `create-market.example.json`.
5. Submit bets with funds in the configured native denom.
6. Either settle the market or cancel it.
7. Winners claim payouts, or bettors refund after cancellation.

## Notes

- `kickoff_ts` and `close_ts` are unix timestamps in seconds.
- `close_ts` must be strictly earlier than `kickoff_ts`.
- The contract only accepts one configured native denom per deployment.
- `cancel_market` is admin-only.
- The script assumes the chain CLI returns JSON including `code_id` and `contract_address`.
