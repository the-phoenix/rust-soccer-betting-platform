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

## Example Flow

1. Store the wasm on-chain with your chain CLI.
2. Instantiate the contract using `instantiate.local.json`.
3. Create a market using `create-market.example.json`.
4. Submit bets with funds in the configured native denom.
5. Either settle the market or cancel it.
6. Winners claim payouts, or bettors refund after cancellation.

## Notes

- `kickoff_ts` and `close_ts` are unix timestamps in seconds.
- `close_ts` must be strictly earlier than `kickoff_ts`.
- The contract only accepts one configured native denom per deployment.
- `cancel_market` is admin-only.
