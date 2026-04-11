import { config as loadEnv } from "dotenv";
import hre from "hardhat";
import { getAddress, parseEther } from "ethers";

loadEnv({ path: "../.env" });
loadEnv();

type IntentResponse = {
  recommendedAsset: string;
  track: "PayFi" | "DeFi";
  shouldUseZkDiscount: boolean;
};

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "https://133.rpc.thirdweb.com";
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  const rwaVault = getAddress(process.env.RWA_VAULT_ADDRESS ?? "0x8337b13E90B25cFE18570b6E946549D158f1D1cF");
  const merchantWallet = getAddress(process.env.MERCHANT_WALLET ?? "0x25f771D0B086602FEc043B6cCa1eD3E5fDcd8F1d");

  requireEnv("PRIVATE_KEY");

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying SentinelPay to HashKey Testnet via ${rpcUrl}`);
  console.log(`Deployer: ${deployer.address}`);

  const factory = await hre.ethers.getContractFactory("SentinelPaySettlementEngine");
  const engine = await factory.deploy(deployer.address, rwaVault, 1_500);
  await engine.waitForDeployment();

  const contractAddress = await engine.getAddress();
  console.log(`Settlement engine deployed to ${contractAddress}`);

  const walletAddress = deployer.address;
  const intentResponse = await fetch(`${backendUrl}/ai/intent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ walletAddress, demoBypass: true })
  });
  const intent = (await intentResponse.json()) as IntentResponse;

  if (intent.recommendedAsset !== "HSK") {
    throw new Error(`AI intent mismatch. Expected HSK for settlement demo, got ${intent.recommendedAsset}`);
  }

  const zkResponse = await fetch(`${backendUrl}/zk/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ walletAddress })
  });
  const { proofHash } = (await zkResponse.json()) as { proofHash: `0x${string}` };

  const tx = await engine.processPayment(merchantWallet, proofHash, intent.track, {
    value: parseEther("0.10")
  });

  const receipt = await tx.wait();
  console.log(`Test settlement confirmed in tx ${receipt?.hash}`);
  console.log(`AI Intent track: ${intent.track}, discount: ${intent.shouldUseZkDiscount ? "enabled" : "disabled"}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
