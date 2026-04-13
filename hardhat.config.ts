import { config as loadEnv } from "dotenv";
import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

loadEnv();

const rpcUrl = process.env.RPC_URL ?? "";
const privateKey = (process.env.PRIVATE_KEY ?? "").trim().replace(/^['"]|['"]$/g, "");

const config: HardhatUserConfig = {
  solidity: "0.8.20",
  networks: {
    hashkey: {
      url: rpcUrl,
      chainId: 133,
      accounts: privateKey ? [privateKey] : []
    }
  }
};

export default config;
