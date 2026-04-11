import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ path: path.resolve(process.cwd(), "../../.env") });
loadEnv();

const required = (value: string | undefined, fallback: string) => value ?? fallback;

export const env = {
  port: Number.parseInt(process.env.PORT ?? "4000", 10),
  rpcUrl: required(process.env.RPC_URL, "https://133.rpc.thirdweb.com"),
  contractAddress: process.env.CONTRACT_ADDRESS,
  jwtSecret: required(process.env.JWT_SECRET, "sentinelpay-demo-secret"),
  siweDomain: required(process.env.SIWE_DOMAIN, "localhost:4000")
};

