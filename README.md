# Soccer Betting Platform

Parallel CosmWasm and Solana/Anchor implementations of a pooled 1X2 soccer betting platform, kept in the same repository.

## Layout

- `contracts/soccer-betting-contract`
  CosmWasm smart contract for pooled 1X2 soccer betting, settlement, cancellation, claims, and refunds.
- `apps/cosm-wasm-web`
  Next.js frontend for the CosmWasm deployment.
- `solana`
  Anchor workspace for the Solana reimplementation.
- `apps/solana-web`
  Next.js frontend for the Solana / Anchor deployment.

## Current Status

The CosmWasm contract and web app are implemented. The Solana / Anchor version now exists alongside them with an Anchor program workspace and a Solana web console for queries and transaction flows.

## CosmWasm Quick Start

```bash
cd contracts/soccer-betting-contract
cargo test
cargo run --bin schema
```

```bash
cd apps/cosm-wasm-web
cp .env.example .env.local
npm install
npm run dev
```

## Solana / Anchor Quick Start

```bash
cd solana
anchor build
anchor test
```

```bash
cd apps/solana-web
cp .env.example .env.local
npm install
npm run dev
```
