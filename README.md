# SentinelPay AI

SentinelPay AI is a hackathon-ready PayFi gateway built for the HashKey Chain ecosystem. The project combines a native HSK settlement flow, an HSP-inspired payment vault, a lightweight AI intent engine, and a NexaID-flavored zero-knowledge identity experience so the demo feels both credible and memorable in three minutes.

## Why It Matters

SentinelPay focuses on the PayFi track first: a user can connect a wallet, prove eligibility through a mocked NexaID ZK flow, receive an AI-guided payment recommendation, and settle the transaction on HashKey Chain L2 while routing a configurable slice of the payment into an RWA vault.

## Stack

- HashKey Chain L2
- HSP-inspired settlement logic
- NexaID verification mock with ZK-style proof hashing
- Next.js
- Tailwind CSS
- Shadcn-style UI patterns
- Wagmi + ConnectKit
- Express + SIWE + JWT
- Solidity + OpenZeppelin

## Project Structure

- `contracts`: Solidity contracts and the `deploy-and-test.ts` deployment script
- `apps/api`: Express backend with AI intent, ZK verification, SIWE auth, and contract event listeners
- `apps/web`: Next.js frontend for the landing page, login flow, dashboard, checkout, and transaction history
- `packages/shared`: Shared AI strategy logic and contract ABI

## Core Flows

### PaymentVault and Settlement Engine

The Solidity layer includes:

- `PaymentVault` for `requestPayment` and `settleWithRWA`
- `SentinelPaySettlementEngine` for direct `processPayment`
- mock NexaID proof validation using deterministic `bytes32` hashes
- RWA-backed routing so part of each HSK payment is sent into a vault
- `PaymentSettled(address indexed merchant, uint256 amount, string track)` for hackathon storytelling across PayFi and DeFi

### AI Intent Engine

The TypeScript strategy engine accepts a wallet snapshot with token balances and yield data, then uses hard-coded heuristic logic to:

- choose the lowest-growth asset to spend
- recommend HSK for RWA holders so they can keep RWAs productive and earn loyalty points
- apply a 5% discount when NexaID is present

The backend exposes this through `/ai/intent` as a JSON mock API for the frontend.

### Identity and Access

SentinelPay uses:

- SIWE challenge generation and signature verification
- JWT session issuance after wallet ownership is proven
- mocked NexaID verification via `/zk/verify`
- a frontend verification modal with a deliberate 2-second proof-generation delay

## Local Development

1. Copy `.env.example` to `.env` and set `PRIVATE_KEY`, `JWT_SECRET`, wallet addresses, and the deployed contract address.
2. Install dependencies with your preferred workspace-aware package manager.
3. Run the backend from `apps/api`.
4. Run the frontend from `apps/web`.
5. Deploy the contract with `contracts/scripts/deploy-and-test.ts`.

## Deployment Script

`deploy-and-test.ts` deploys the settlement engine to HashKey Chain Testnet using:

- RPC: `https://133.rpc.thirdweb.com`
- Chain ID: `133`

It then calls the backend AI and ZK endpoints, validates that the mocked AI intent aligns with the settlement rail, and sends a test payment on-chain.

## Future Roadmap

- move from mocked proof validation to a real NexaID verifier contract or attestation bridge
- support merchant-configurable HSP settlement policies and dynamic fee splits
- expand the AI engine from simple heuristics to policy-based treasury optimization
- scale the RWA settlement layer toward institutional vault routing and post-trade reporting
# sentinelpay-ai
# sentinelpay-ai
