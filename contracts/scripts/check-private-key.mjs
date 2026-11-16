import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
loadEnv({ path: path.join(root, ".env.local") });
loadEnv({ path: path.join(root, ".env") });

const privateKey = process.env.PRIVATE_KEY ?? "";
const sanitizedKey = privateKey.startsWith("0x")
  ? privateKey.slice(2)
  : privateKey;

if (!privateKey.trim()) {
  console.warn("SentinelPay: the legacy PRIVATE_KEY is not configured.");
  process.exit(1);
}

if (!/^[0-9a-fA-F]{64}$/.test(sanitizedKey)) {
  console.warn(
    "SentinelPay: the legacy PRIVATE_KEY must contain 32 hex-encoded bytes.",
  );
  process.exit(1);
}

console.log("SentinelPay: legacy PRIVATE_KEY has the expected hex format.");
