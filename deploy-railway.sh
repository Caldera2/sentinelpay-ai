#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
WEB_ENV_FILE="${ROOT_DIR}/apps/web/.env.local"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_env_value() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d '=' -f2- || true)"

  if [[ -z "$value" ]]; then
    echo "Missing ${key} in ${ENV_FILE}" >&2
    exit 1
  fi

  if [[ "$key" == "NEXT_PUBLIC_CONTRACT_ADDRESS" && "$value" =~ ^0x0+$ ]]; then
    echo "NEXT_PUBLIC_CONTRACT_ADDRESS is still the zero-address placeholder." >&2
    exit 1
  fi
}

append_or_replace_env() {
  local file="$1"
  local key="$2"
  local value="$3"

  mkdir -p "$(dirname "$file")"
  touch "$file"

  if grep -qE "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*$|${key}=${value}|" "$file"
    rm -f "${file}.bak"
  else
    printf "%s=%s\n" "$key" "$value" >> "$file"
  fi
}

require_command npx
require_command grep
require_command sed

if ! npx @railway/cli whoami >/dev/null 2>&1; then
  echo "Railway CLI is not authenticated. Run: npx @railway/cli login" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

require_env_value "DATABASE_URL"
require_env_value "NEXT_PUBLIC_CONTRACT_ADDRESS"

WORKSPACE_ID="${RAILWAY_WORKSPACE_ID:-}"
PROJECT_ID="${RAILWAY_PROJECT_ID:-}"
SERVICE_NAME="${RAILWAY_SERVICE_NAME:-sentinelpay-api}"

if [[ -n "$PROJECT_ID" ]]; then
  npx @railway/cli project link -w "$WORKSPACE_ID" -p "$PROJECT_ID" --json >/dev/null
else
  CREATED_PROJECT="$(npx @railway/cli init -n sentinelpay-ai --json)"
  echo "$CREATED_PROJECT"
fi

if ! npx @railway/cli service link "$SERVICE_NAME" >/dev/null 2>&1; then
  npx @railway/cli add -s "$SERVICE_NAME" --json >/dev/null
  npx @railway/cli service link "$SERVICE_NAME" >/dev/null
fi

npx @railway/cli up --service "$SERVICE_NAME" --detach

SERVICE_URL="$(npx @railway/cli domain --service "$SERVICE_NAME" --json | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(data.domain || '');")"

if [[ -z "$SERVICE_URL" ]]; then
  echo "Unable to resolve Railway service URL." >&2
  exit 1
fi

append_or_replace_env "$WEB_ENV_FILE" "NEXT_PUBLIC_API_URL" "$SERVICE_URL"

echo "NEXT_PUBLIC_API_URL updated in ${WEB_ENV_FILE}"
echo "Railway backend URL: ${SERVICE_URL}"
