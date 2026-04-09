# PitchPool Solana Web

Next.js frontend for the Anchor-based Solana version of the soccer betting platform.

## Current Scope

- Read config, market, and bettor PDA state from the Solana program.
- Connect an injected Solana wallet.
- Submit create, bet, settle, cancel, claim, refund, and withdraw-fee transactions.

## Quick Start

```bash
cd apps/solana-web
cp .env.example .env.local
npm install
npm run dev
```
