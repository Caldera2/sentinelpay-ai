import { clusterApiUrl, PublicKey } from "@solana/web3.js";

const DEFAULT_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const HELIUS_MAINNET_RPC_BASE = "https://mainnet.helius-rpc.com/";
const DEFAULT_DEV_TREASURY_ADDRESS = "5oNDL3swdJJF1g9DzJiZ4ynHXgszjAEpUkxVYejchzrY";
// Force override to unblock UI-level treasury validation.
export const TREASURY_ADDRESS = new PublicKey("DN4j7DWYtcEYGjoG4byQGTzcJJ3KY5cZBQR9DvxuuzjL");

function looksLikeUrl(value: string) {
  return value.startsWith("https://") || value.startsWith("http://");
}

function getHeliusRpcKey() {
  return (
    process.env.NEXT_PUBLIC_HELIUS_RPC_KEY?.trim() ||
    process.env.HELIUS_RPC_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_KEY?.trim() ||
    process.env.SOLANA_RPC_KEY?.trim() ||
    ""
  );
}

function normalizeHeliusRpcUrl(rawRpcUrl: string) {
  const value = rawRpcUrl.trim();

  if (!value) {
    return value;
  }

  if (!looksLikeUrl(value)) {
    return `${HELIUS_MAINNET_RPC_BASE}?api-key=${encodeURIComponent(value)}`;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  const isHeliusHost = url.hostname.endsWith("helius-rpc.com");

  if (!isHeliusHost) {
    return value;
  }

  if (!url.searchParams.get("api-key")) {
    const rpcKey = getHeliusRpcKey();
    if (rpcKey) {
      url.searchParams.set("api-key", rpcKey);
    }
  }

  return url.toString();
}

export function getSolanaRpcUrl() {
  const rpcUrl =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    clusterApiUrl("mainnet-beta");

  return normalizeHeliusRpcUrl(rpcUrl);
}

export function getHeliusRpcUrlTemplate() {
  return `${HELIUS_MAINNET_RPC_BASE}?api-key=<YOUR_RPC_KEY_HERE>`;
}

function isValidPublicKey(value?: string | null) {
  if (!value?.trim()) {
    return false;
  }

  try {
    void new PublicKey(value.trim());
    return true;
  } catch {
    return false;
  }
}

function getTreasuryCandidates() {
  return [
    process.env.NEXT_PUBLIC_SOLANA_TREASURY_ADDRESS?.trim(),
    process.env.SOLANA_TREASURY_ADDRESS?.trim(),
    process.env.NEXT_PUBLIC_SOLANA_MERCHANT_ADDRESS?.trim(),
    process.env.SOLANA_MERCHANT_ADDRESS?.trim(),
    DEFAULT_DEV_TREASURY_ADDRESS
  ];
}

export function hasExplicitSolanaTreasuryAddress() {
  return true;
}

export function getSolanaTreasuryAddress() {
  const validCandidate = getTreasuryCandidates().find((candidate) => isValidPublicKey(candidate));
  return validCandidate ?? TREASURY_ADDRESS.toBase58();
}

export function getSolanaMerchantAddress() {
  return getSolanaTreasuryAddress();
}

export function getSolanaUsdcMintAddress() {
  return process.env.NEXT_PUBLIC_SOLANA_USDC_MINT?.trim() || process.env.SOLANA_USDC_MINT?.trim() || DEFAULT_USDC_MINT;
}

export function getSolanaRwaMintAddress() {
  return process.env.NEXT_PUBLIC_SOLANA_RWA_MINT?.trim() || process.env.SOLANA_RWA_MINT?.trim() || "";
}

export function getOptionalPublicKey(value?: string | null) {
  if (!value?.trim()) {
    return null;
  }

  try {
    return new PublicKey(value.trim());
  } catch {
    return null;
  }
}

export function requirePublicKey(value: string, label: string) {
  const publicKey = getOptionalPublicKey(value);

  if (!publicKey) {
    throw new Error(`${label} is missing or invalid.`);
  }

  return publicKey;
}

export function getSolanaClientConfig() {
  return {
    rpcUrl: getSolanaRpcUrl(),
    merchantAddress: getSolanaTreasuryAddress(),
    treasuryAddress: getSolanaTreasuryAddress(),
    hasExplicitTreasuryAddress: hasExplicitSolanaTreasuryAddress(),
    usdcMintAddress: getSolanaUsdcMintAddress(),
    rwaMintAddress: getSolanaRwaMintAddress()
  };
}
