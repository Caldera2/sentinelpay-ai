# SentinelPay

Solana USDC invoices and merchant cash reserve planning. Customers pay through a hosted checkout or Solana Action; the API verifies finalized transactions before recording revenue. Merchant wallets retain custody of funds.

## Implemented

- Solana Ed25519 wallet sign-in, expiring single-use challenges, and revocable one-hour HttpOnly sessions.
- Merchant-owned invoices with fixed USDC amounts, expiry, idempotent request IDs, and separate customer checkout pages.
- Exact integer money calculations, case-sensitive public keys/signatures, and invoice-bound transaction memos.
- Finalized on-chain verification of payer signature, memo, time window, USDC mint, recipient account, and credited amount.
- PostgreSQL ledger with unique receipt constraints, transactions, pagination, CSV export, and an audit trail.
- Cash reserve recommendations from actual wallet balances and saved merchant expenses/reserves. This is a deterministic policy engine; no model or fixed yield is claimed.
- Optional server-side Jupiter ExactOut swaps for invoice payments. ExactIn is used for optional merchant treasury swaps. Unsupported routes fail without submitting a payment.

The former mock identity proofs, UI discounts, hardcoded merchant recipient, local-storage ledger, and simulated earnings are removed. No identity verification or transaction privacy guarantee is provided.

## Local setup

Requires Node.js 22.13 or later and npm workspaces.

```sh
npm ci
# Copy .env.example to .env.local at the repository root.
# Copy API_URL and API_PROXY_SECRET into apps/web/.env.local.
npm run dev
```

Open http://localhost:3000. The API runs on port 4000. Development defaults to **devnet** with Circle devnet USDC. Acquire devnet SOL and test USDC separately; the app does not fund wallets. Sign in with the merchant wallet, create an invoice, and pay using a different wallet.

When DATABASE_URL is blank in development, PGlite persists a local PostgreSQL-compatible database in apps/api/data/postgres. Do not use this single-process development store in production. Previous mock JSON records are not imported as verified receipts.

## Validation

```sh
npm test
npm run typecheck
npm run security:scan
npm run build
npm run test:contracts
npm audit --omit=dev
```

Tests use a real in-memory PostgreSQL-compatible engine, ephemeral signing keys, HTTP requests, and synthetic Solana transaction fixtures. They do not transfer funds or claim live provider verification.

## Production configuration

Set APP_ORIGIN to the exact HTTPS web origin. Configure SOLANA_CLUSTER explicitly, SOLANA_RPC_URL for the same network, a PostgreSQL DATABASE_URL, and a unique API_PROXY_SECRET of at least 32 characters. Set the same proxy secret and the API's HTTPS API_URL on the web server. Keep all provider/database secrets server-side. No NEXT_PUBLIC secrets are needed.

Run `npm run db:migrate` explicitly before starting the production API. The API does not silently migrate or recreate a production ledger. Use a dedicated database role, verified TLS, backups, and a single API process; a shared rate-limit store is needed before horizontal scaling. The web proxies only supported endpoints, and the API requires the proxy credential in production.

```sh
npm run build
npm run start:api
npm run start --workspace @sentinelpay/web
```

Railway configuration builds only shared/API workspaces; the web is a separate Next.js deployment. See [AUDIT.md](AUDIT.md) for findings, validation evidence, and remaining launch prerequisites. Vercel client addresses are forwarded through the authenticated proxy for individual rate limits; other hosting setups share limits by proxy address until a trusted client-address integration is configured.

## Swaps and treasury

Direct USDC payments work without Jupiter. Mainnet token swaps additionally require JUPITER_API_KEY. The invoice path intentionally retains Jupiter's V1 ExactOut contract: V2 `/build` supports ExactIn and cannot be substituted without preserving invoice amount guarantees. If V1 is unavailable or changes its contract, swap checkout fails closed and direct USDC remains available.

Treasury trading is off by default. Enabling TREASURY_ENABLED requires mainnet, JUPITER_API_KEY, an independently verified official SOLANA_RWA_MINT, and a review of the provider's eligibility, liquidity, and redemption rules. Eligibility acknowledgment is a merchant declaration, not KYC or a credential proof. Each swap requires the merchant wallet signature. USDY acquisition/exit through a swap pool is distinct from issuer minting/redemption. The app does not promise a rate of return or perform unattended sweeps.

Useful primary references: [Jupiter migration](https://developers.jup.ag/docs/swap/migration/metis-to-build), [Solana transaction RPC](https://solana.com/docs/rpc/http/gettransaction), [Ondo USDY](https://ondo.finance/usdy).

## Legacy EVM code

The contracts directory is a legacy HashKey experiment, independent of the active Solana payment flow. Its contracts are not used to secure Solana invoices. Compile separately with `npm run build:contracts`; no deployment or funded transaction is part of normal development/testing. Do not use the former production keypair or credentials.

## Exposed credentials

An earlier version committed a deployment keypair and a production environment export. Their working-tree copies are removed and ignored. Git history and external copies still contain that material. Replace any signing keys that retain authority, revoke any still-valid credentials, and coordinate any Git history rewrite with repository collaborators. Removing files is not credential rotation.
