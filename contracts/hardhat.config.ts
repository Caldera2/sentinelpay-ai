import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import { defineConfig } from "hardhat/config";
const directory = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(directory, "../.env.local") });
loadEnv({ path: path.resolve(directory, "../.env") });

const enabled = process.env.ENABLE_LEGACY_DEPLOYMENT === "true";
export default defineConfig({
  plugins: [hardhatEthers, hardhatEthersChaiMatchers, hardhatMocha],
  solidity: {
    version: "0.8.26",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: { type: "edr-simulated", chainType: "l1", hardfork: "cancun" },
    ...(enabled
      ? {
          hashkeyTestnet: {
            type: "http",
            url: process.env.LEGACY_RPC_URL || "",
            chainId: 133,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
          },
        }
      : {}),
  },
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts",
    tests: { mocha: "./test" },
  },
});
