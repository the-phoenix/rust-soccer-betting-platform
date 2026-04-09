# Solana / Anchor Version

This directory contains a Solana reimplementation of the soccer betting contract using Anchor.

## Layout

- `programs/soccer-betting-anchor`
  Anchor program for pooled 1X2 soccer betting with market creation, bets, settlement, cancellation, claims, refunds, and fee withdrawal.
- `../apps/solana-web`
  Next.js frontend for querying and driving the Solana program.

## Notes

- Stakes are handled in native SOL lamports instead of a CosmWasm bank denom.
- The current placeholder program id is `7ktmkWvLqKowac7ZUqkhdCiYVAcc3WS6h8HXVpRQ3z5u`. Replace it before deployment if you generate your own keypair.

## Quick Start

```bash
cd solana
anchor build
anchor test
```
