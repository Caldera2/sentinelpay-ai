import { clusterApiUrl, Commitment, Connection, PublicKey } from "@solana/web3.js";

const HELIUS_MAINNET_RPC_BASE = "https://mainnet.helius-rpc.com/";
const PUBLIC_MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";

export function getRpcUrl() {
  const rawUrl = (
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    process.env.SOLANA_RPC_URL?.trim() ||
    ""
  ).trim();

  if (!rawUrl) {
    return clusterApiUrl("mainnet-beta");
  }

  const endpoint = rawUrl.startsWith("rpc_")
    ? `${HELIUS_MAINNET_RPC_BASE}?api-key=${encodeURIComponent(rawUrl)}`
    : rawUrl;

  return endpoint;
}

function redactRpcUrl(url: string) {
  try {
    const parsed = new URL(url);
    const apiKey = parsed.searchParams.get("api-key");
    if (apiKey) {
      parsed.searchParams.set(
        "api-key",
        `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`
      );
    }
    return parsed.toString();
  } catch {
    return url.length > 12 ? `${url.slice(0, 6)}...${url.slice(-4)}` : url;
  }
}

function isFailoverEligibleError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  const candidates = [error, ...(error && typeof error === "object" ? Object.values(error as Record<string, unknown>) : [])];

  const hasKnownCode = candidates.some((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }

    const obj = candidate as Record<string, unknown>;
    const code = obj.code;
    const status = obj.status;
    return code === 401 || code === 403 || code === 429 || status === 401 || status === 403 || status === 429;
  });

  return (
    hasKnownCode ||
    lowered.includes("401") ||
    lowered.includes("403") ||
    lowered.includes("429") ||
    lowered.includes("unauthorized") ||
    lowered.includes("forbidden") ||
    lowered.includes("rate limit")
  );
}

export class SentinelConnection {
  private static instance: SentinelConnection | null = null;
  private fallbackActive = false;
  readonly commitment: Commitment = "confirmed";
  readonly primaryRpcUrl: string;
  readonly fallbackRpcUrl: string;
  readonly primary: Connection;
  readonly fallback: Connection;
  readonly endpoint: string;

  private constructor(primaryRpcUrl: string, fallbackRpcUrl = PUBLIC_MAINNET_RPC_URL) {
    this.primaryRpcUrl = primaryRpcUrl;
    this.fallbackRpcUrl = fallbackRpcUrl;
    this.endpoint = primaryRpcUrl;
    this.primary = new Connection(primaryRpcUrl, {
      commitment: this.commitment,
      confirmTransactionInitialTimeout: 30_000,
      disableRetryOnRateLimit: false
    });
    this.fallback = new Connection(fallbackRpcUrl, {
      commitment: this.commitment,
      confirmTransactionInitialTimeout: 30_000,
      disableRetryOnRateLimit: false
    });
  }

  static getInstance() {
    if (!SentinelConnection.instance) {
      const primary = getRpcUrl();
      console.info("Target RPC:", primary.split("?")[0]);
      console.info("[SentinelPay] RPC init:", redactRpcUrl(primary));
      SentinelConnection.instance = new SentinelConnection(primary);
    }
    return SentinelConnection.instance;
  }

  private async withFailover<T>(call: (connection: Connection) => Promise<T>) {
    try {
      const result = await call(this.primary);
      return result;
    } catch (error) {
      if (!isFailoverEligibleError(error)) {
        throw error;
      }

      this.fallbackActive = true;
      console.warn("[RPC_FAILOVER] Primary provider auth error. Falling back to public cluster.");
      return call(this.fallback);
    }
  }

  isFallbackActive() {
    return this.fallbackActive;
  }

  getAccountInfo(publicKey: PublicKey, commitment: Commitment = this.commitment) {
    return this.withFailover((connection) =>
      connection.getAccountInfo(publicKey, commitment)
    );
  }

  getLatestBlockhash(commitment: Commitment = this.commitment) {
    return this.withFailover((connection) =>
      connection.getLatestBlockhash(commitment)
    );
  }

  simulateTransaction(...args: unknown[]) {
    return this.withFailover((connection) =>
      (connection.simulateTransaction as (...inner: unknown[]) => Promise<unknown>)(...args)
    );
  }

  getAddressLookupTable(address: PublicKey) {
    return this.withFailover((connection) =>
      connection.getAddressLookupTable(address)
    );
  }

  getTokenAccountBalance(address: PublicKey, commitment: Commitment = this.commitment) {
    return this.withFailover((connection) =>
      connection.getTokenAccountBalance(address, commitment)
    );
  }

  onAccountChange(...args: Parameters<Connection["onAccountChange"]>) {
    return this.primary.onAccountChange(...args);
  }

  removeAccountChangeListener(listener: number) {
    return this.primary.removeAccountChangeListener(listener);
  }
}

export const solanaRpcUrl = getRpcUrl();
export const resilientSolanaConnection = SentinelConnection.getInstance();
export const solanaConnection = resilientSolanaConnection;
