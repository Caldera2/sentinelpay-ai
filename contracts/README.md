# Legacy EVM experiment

These HashKey Solidity contracts are independent of the active Solana invoice application. They transfer native HSK between a merchant and a configured allocation address; they do not mint, buy, or redeem USDY and provide no zero-knowledge proof system.

The audit removes deterministic proof bypasses, guards the payment entry point against reentrancy, restricts external settlement to the settlement role, validates tracks at request creation, and snapshots the allocation recipient for each request. An administrator must explicitly approve and may revoke each payer proof hash. This is an administrator allowlist, not identity verification.

Normal builds and tests never deploy to a remote chain. Legacy deployment requires ENABLE_LEGACY_DEPLOYMENT=true, LEGACY_RPC_URL, a newly provisioned PRIVATE_KEY, and RWA_VAULT_ADDRESS. The deployment script starts allocation at zero and sends no funded checkout transaction. Existing deployed bytecode does not receive source fixes automatically.

Use `npm run build:contracts` and `npm run test:contracts` from the root after installing workspace dependencies. A separate external contract review is required before using any deployment to hold funds.

Testing uses Hardhat 3, ethers 6, ESM configuration, and the maintained Mocha/ethers plugins. Solidity remains pinned to local solc 0.8.26; the build script compiles without downloading a compiler or accessing a remote chain. Test artifacts are generated locally and ignored.
