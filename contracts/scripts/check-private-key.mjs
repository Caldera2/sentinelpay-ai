import { config as loadEnv } from "dotenv";

loadEnv({ path: "../.env" });
loadEnv();

const privateKey = process.env.PRIVATE_KEY ?? "";
const sanitizedKey = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;

if (!privateKey.trim()) {
  console.warn("SentinelPay: PRIVATE_KEY is not set yet. Add it to contracts/.env or ../.env before deploying to hashkey.");
  process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(sanitizedKey)) {
  console.warn("SentinelPay: PRIVATE_KEY is set, but it doesn't look like a full 32-byte hex key yet. Update contracts/.env or ../.env before deploying.");
  process.exit(1);
}

console.log("SentinelPay: PRIVATE_KEY looks valid. You're ready to deploy.");
