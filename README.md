SentinelPay AI 
SentinelPay AI is a high-performance PayFi (Payment Finance) gateway built for the Solana ecosystem. The project merges Solana Actions/Blinks for one-click settlement, an RWA-integrated payment vault, and a lightweight AI intent engine to transform idle merchant revenue into active yield-bearing assets.

Why It Matters
SentinelPay solves the Capital Inefficiency Gap in on-chain commerce. Instead of merchant revenue sitting idle in static stablecoins, our protocol automatically routes a configurable slice of every transaction into institutional-grade RWA vaults (e.g., Ondo USDY) the moment the transaction settles.

Stack
L1 Blockchain: Solana (Mainnet-ready)

UX/Checkout: Solana Actions & Blinks

Liquidity Routing: Jupiter V6 API

Yield Generation: Ondo Finance (USDY)

Infrastructure: Helius RPC

Frontend: Next.js + Tailwind CSS

Backend: Supabase (PostgreSQL) + FastAPI

Wallet Integration: Phantom / Backpack

Project Structure
programs: Anchor/Rust smart contracts for the Settlement Engine.

apps/web: Next.js frontend featuring the Merchant Dashboard, Blink generator, and RWA yield tracker.

apps/api: Backend handling AI intent logic and real-time transaction indexing via Supabase.

packages/sdk: Shared TypeScript logic for Blink construction and Jupiter swap routing.

Core Flows
1. Atomic Settlement & RWA Routing
The protocol utilizes a specialized settlement logic:

Split-to-Yield: Every payment can be split between the merchant's liquid wallet and a yield-bearing RWA vault.

Atomic Swaps: Uses Jupiter V6 to perform atomic User Token -> USDC -> USDY swaps in a single transaction.

Native Blinks: Transactions are packaged as Solana Blinks, allowing checkout to happen directly on social media platforms.

2. AI Intent Engine
The strategy engine analyzes merchant liquidity and market yield data to:

Recommend Yield Splits: Optimizes the percentage of revenue routed to RWAs based on the merchant's upcoming cash-flow needs.

Fee Optimization: Automatically chooses the most efficient liquidity path via Jupiter to minimize slippage during settlement.

3. High-Performance Infrastructure
Helius RPC: Utilizes dedicated rpc_ keys for high-velocity transaction simulation and landing rates.

Resilient Connections: Implements singleton connection patterns with automated failover to ensure 100% uptime during high network congestion.

Local Development
Set NEXT_PUBLIC_SOLANA_RPC_URL in .env with your Helius RPC Key.

Define NEXT_PUBLIC_SOLANA_TREASURY_ADDRESS to route platform fees.

Install dependencies using your workspace-aware package manager.

Run npm run dev to launch the Merchant Dashboard.

Future Roadmap
Dynamic Fee Splits: Support for complex, multi-party settlement policies.

Institutional Reporting: Real-time post-trade reporting for RWA tax compliance.

Advanced AI Treasury: Moving from simple heuristics to full policy-based treasury optimization for SMEs.
