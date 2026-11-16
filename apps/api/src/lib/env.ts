import { config as loadEnv } from "dotenv";
import path from "node:path";
import { z } from "zod";
import { PublicKey, clusterApiUrl } from "@solana/web3.js";
import { SOLANA_NETWORKS } from "@sentinelpay/shared";

loadEnv({ path: path.resolve(__dirname, "../../../../.env.local") });
loadEnv({ path: path.resolve(__dirname, "../../../../.env") });
loadEnv();

export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const production = source.NODE_ENV === "production";
  const cluster = z
    .enum(["devnet", "mainnet-beta"])
    .parse(source.SOLANA_CLUSTER || "devnet");
  const appOrigin = z
    .string()
    .url()
    .parse(source.APP_ORIGIN || "http://localhost:3000");
  const appUrl = new URL(appOrigin);
  if (
    appUrl.origin !== appOrigin ||
    appUrl.username ||
    appUrl.password ||
    (production && appUrl.protocol !== "https:")
  )
    throw new Error(
      "APP_ORIGIN must be a single origin (HTTPS in production).",
    );
  if (production && !source.DATABASE_URL)
    throw new Error("DATABASE_URL is required in production.");
  if (production && !source.SOLANA_RPC_URL)
    throw new Error("SOLANA_RPC_URL is required in production.");
  if (
    production &&
    (!source.API_PROXY_SECRET || source.API_PROXY_SECRET.length < 32)
  )
    throw new Error(
      "API_PROXY_SECRET must contain at least 32 characters in production.",
    );
  const rpcUrl = z
    .string()
    .url()
    .parse(source.SOLANA_RPC_URL || clusterApiUrl(cluster));
  if (production && new URL(rpcUrl).protocol !== "https:")
    throw new Error("Production RPC must use HTTPS.");
  const usdcMint = SOLANA_NETWORKS[cluster].usdcMint;
  const rwaMint = source.SOLANA_RWA_MINT?.trim() || null;
  if (rwaMint) new PublicKey(rwaMint);
  const treasuryEnabled = source.TREASURY_ENABLED === "true";
  if (
    treasuryEnabled &&
    (cluster !== "mainnet-beta" || !rwaMint || !source.JUPITER_API_KEY)
  )
    throw new Error(
      "Treasury trading requires mainnet, a reviewed RWA mint, and JUPITER_API_KEY.",
    );
  return {
    production,
    cluster,
    appOrigin,
    rpcUrl,
    usdcMint,
    rwaMint,
    treasuryEnabled,
    port: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(source.PORT || "4000"),
    databaseUrl: source.DATABASE_URL || null,
    dataDir: source.DATA_DIR || path.resolve(process.cwd(), "data/postgres"),
    jupiterApiKey: source.JUPITER_API_KEY || null,
    swapEnabled: cluster === "mainnet-beta" && Boolean(source.JUPITER_API_KEY),
    proxySecret: source.API_PROXY_SECRET || null,
  };
}
export type AppConfig = ReturnType<typeof readEnv>;
