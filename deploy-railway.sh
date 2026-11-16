#!/usr/bin/env bash
set -euo pipefail
# Deploy only an already configured, linked API service. No secrets are read or printed.
command -v npx >/dev/null
npx @railway/cli whoami >/dev/null
printf '%s\n' 'Ensure APP_ORIGIN, DATABASE_URL, SOLANA_CLUSTER, SOLANA_RPC_URL and API_PROXY_SECRET are configured in the selected API service.'
printf '%s\n' 'Run the database migration in the target environment before starting the new API.'
npx @railway/cli up --detach
