import { config as loadEnv } from "dotenv";
import "@nomicfoundation/hardhat-toolbox";
import { HardhatUserConfig } from "hardhat/config";

loadEnv({ path: "../.env" });
loadEnv();

function normalizePrivateKey(value: string) {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  return trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
}

const privateKey = process.env.PRIVATE_KEY ?? "";
const sanitizedKey = normalizePrivateKey(privateKey);
const hasValidKey = /^[0-9a-fA-F]{64}$/.test(sanitizedKey);
const accounts = hasValidKey ? [`0x${sanitizedKey}`] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hashkey: {
      url: process.env.RPC_URL ?? "https://133.rpc.thirdweb.com",
      chainId: 133,
      accounts
    }
  },
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};

export default config;
