import { config as loadEnv } from "dotenv";
import path from "node:path";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import type { HardhatUserConfig } from "hardhat/config";
loadEnv({ path: path.resolve(__dirname, "../.env.local") });
loadEnv({ path: path.resolve(__dirname, "../.env") });

const enabled = process.env.ENABLE_LEGACY_DEPLOYMENT === "true";
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.26",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: enabled
    ? {
        hashkeyTestnet: {
          url: process.env.LEGACY_RPC_URL || "",
          chainId: 133,
          accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
        },
      }
    : {},
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts",
    tests: "./test",
  },
};
export default config;
