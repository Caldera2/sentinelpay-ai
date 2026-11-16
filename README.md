# SentinelPay

Solana USDC invoices and merchant cash reserve planning. Customers pay through a hosted checkout or Solana Action; the API verifies finalized transactions before recording revenue. Merchant wallets retain custody of funds.

## Implemented

- Solana Ed25519 wallet sign-in, expiring single-use challenges, and revocable one-hour HttpOnly sessions.
- Merchant-owned invoices with fixed USDC amounts, expiry, idempotent request IDs, and separate customer checkout pages.
- Exact integer money calculations, case-sensitive public keys/signatures, and invoice-bound transaction memos.
- Finalized on-chain verification of payer signature, memo, time window, USDC mint, recipient account, and credited amount.
- PostgreSQL receipt ledger with unique signatures, duplicate/overpayment tracking, transactions, pagination, CSV export, and an audit trail.
- Merchant-signed partial and full USDC refunds to the original verified payer, with receipt recovery and net revenue accounting.
- Cash reserve recommendations from actual wallet balances and saved merchant expenses/reserves. This is a deterministic policy engine; no model or fixed yield is claimed.
- Optional server-side Jupiter ExactOut swaps for invoice payments. ExactIn is used for optional merchant treasury swaps. Unsupported routes fail without submitting a payment.

The former mock identity proofs, UI discounts, hardcoded merchant recipient, local-storage ledger, and simulated earnings are removed. No identity verification or transaction privacy guarantee is provided.

## Local setup

Requires Node.js 22.13 or later and npm 11.21.2. CI and the API deployment install use the pinned npm version so local workspace security overrides are applied consistently.

```sh
npx --yes npm@11.21.2 ci
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
npm run security:audit
```

By default, the regression suite uses PGlite. Set `TEST_DATABASE_URL` to run the same suite against a real PostgreSQL server; each test file uses its own temporary schema. The database role needs permission to create and drop those schemas. CI exercises both engines.

For the automated browser flows, set `TEST_DATABASE_URL` to a **local** PostgreSQL database, install Chromium with `npx playwright install chromium`, then run `npm run test:browser`. On Windows, `PLAYWRIGHT_SYSTEM_CHROME=1` selects an installed Chrome instead. The runner starts isolated API/web fixtures and exercises wallet sign-in, invoice checkout, a lost broadcast response, partial/full refunds, cancellation after a rejected wallet attempt, reload persistence, and sign-out. Its generated wallet keys and simulated chain exist only in the test environment; no real wallet or funds are used. Jupiter contract tests mock provider responses and verify quote constraints and composed transaction instructions.

See [AUDIT.md](AUDIT.md) for actual database, browser, build, contract, and live dependency scan results. Test artifacts are written under the ignored `audit-output/` directory.

The production dependency scan is clean. Raw `npm audit` still reports one upstream Zod 3 advisory through six legacy Hardhat packages. The complete CI check permits only the documented development-only exception and rejects other findings. See [dependency review](security/DEPENDENCIES.md).

## Production configuration

Set APP_ORIGIN to the exact HTTPS web origin. Configure SOLANA_CLUSTER explicitly, SOLANA_RPC_URL for the same network, a PostgreSQL DATABASE_URL, and a unique API_PROXY_SECRET of at least 32 characters. Set the same proxy secret and the API's HTTPS API_URL on the web server. Keep all provider/database secrets server-side. No NEXT_PUBLIC secrets are needed.

Run `npm run db:migrate` explicitly before starting the production API. Schema version 2 preserves existing verified receipts, adds the receipt/refund ledger, and removes sessions/challenges belonging to the retired signing address. The API does not silently migrate or recreate a production ledger. Use a dedicated database role, verified TLS, backups, and a single API process; a shared rate-limit store is needed before horizontal scaling. The web proxies only supported endpoints, and the API requires the proxy credential in production.

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

## Invoice cancellation

The signed-in merchant who owns an invoice can cancel it while it remains unpaid (`open`), including after failed transactions, rejected wallet prompts, expired attempts, or unresolved attempts. An expired unpaid invoice can also be cancelled. Repeating cancellation returns the same cancelled invoice. Paid invoices require the refund workflow instead.

Cancellation closes checkout and prevents new payment preparation. It cannot revoke a transaction already signed or sent. Existing attempts remain available for receipt recovery; any transfer verified after cancellation is labelled **Payment on cancelled invoice**, counts as refundable excess rather than invoice revenue, and can be refunded to its original payer. Cancellation and payment confirmation lock the same invoice row, so a concurrent payment either settles first and prevents cancellation, or is recorded against the cancelled invoice without reopening it.

## Refunds and duplicate payments

Every verified incoming signature is recorded. The first receipt pays an open invoice; additional transfers and payments on cancelled invoices remain visible as excess funds rather than inflating revenue. A merchant can refund up to the unrefunded amount of each receipt. The destination is fixed to its original payer, and every refund needs the merchant wallet signature and a finalized receipt. Returning overpayment or a duplicate transfer reduces excess liability first; returning invoice funds reduces net invoice revenue.

Only one refund can remain pending per merchant. A submitted signature is retained before broadcast, and reconciliation recovers finalized refunds when a browser callback is lost. Uncertain settlement prevents replacement; older unresolved refunds require receipt investigation. This ledger covers supported, verified invoice/refund transactions, not arbitrary transfers made outside the application.

## Legacy EVM code

The contracts directory is a legacy HashKey experiment, independent of the active Solana payment flow. Its contracts are not used to secure Solana invoices. Compile separately with `npm run build:contracts`; no deployment or funded transaction is part of normal development/testing. Do not use the former production keypair or credentials.

## Exposed credentials

An earlier version committed a deployment keypair and a production environment export. Their working-tree copies are removed and ignored, and the signing address is permanently retired within the application. The exported Vercel token is expired; the RPC value was confirmed to be a placeholder. Live devnet/mainnet checks found no account, owned token accounts, or upgradeable-program authority for the exposed address. See [the exposure review](security/EXPOSURE_REVIEW.md) for evidence and the exact limits of those checks. Git history still contains retired material; never reuse it. No Git history rewrite or unrelated account changes were performed.
