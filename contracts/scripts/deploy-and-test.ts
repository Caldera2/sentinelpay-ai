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

const ACCEPTED_SMOKE_TEST_ASSETS = new Set(["HSK", "HASHKEY", "USDT"]);

function normalizePrivateKey(value: string) {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  return trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
}

function requireValidPrivateKey() {
  const value = process.env.PRIVATE_KEY ?? "";

  if (!value.trim()) {
    throw new Error("PRIVATE_KEY is not set yet. Add it to contracts/.env or ../.env before deploying to hashkey.");
  }

  const normalized = normalizePrivateKey(value);

  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("PRIVATE_KEY is set, but it doesn't look like a full 32-byte hex key yet.");
  }

  return `0x${normalized}`;
}

function shouldBypassAiAssetCheck() {
  const value = (process.env.BYPASS_AI_ASSET_CHECK ?? "true").trim().toLowerCase();
  return value !== "false" && value !== "0" && value !== "no";
}

function normalizeAssetSymbol(value: string) {
  return value.trim().toUpperCase();
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "https://133.rpc.thirdweb.com";
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:4000";
  const rwaVault = getAddress(process.env.RWA_VAULT_ADDRESS ?? "0x8337b13E90B25cFE18570b6E946549D158f1D1cF");
  const merchantWallet = getAddress(process.env.MERCHANT_WALLET ?? "0x25f771D0B086602FEc043B6cCa1eD3E5fDcd8F1d");

  requireValidPrivateKey();

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account was loaded for the hashkey network. Check PRIVATE_KEY and Hardhat network config.");
  }
  console.log(`Deploying SentinelPay to HashKey Testnet via ${rpcUrl}`);
  console.log(`Deployer: ${deployer.address}`);

  const factory = await hre.ethers.getContractFactory("SentinelPaySettlementEngine");
  const engine = await factory.deploy(deployer.address, rwaVault, 1_500);
  await engine.waitForDeployment();

  const contractAddress = await engine.getAddress();
  console.log(`Settlement engine deployed to ${contractAddress}`);
  console.log(`[SENTINEL_ACTIVATE]: ${contractAddress}`);

  const walletAddress = deployer.address;
  const intentResponse = await fetch(`${backendUrl}/ai/intent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ walletAddress, demoBypass: true })
  });
  const intent = (await intentResponse.json()) as IntentResponse;
  const normalizedAsset = normalizeAssetSymbol(intent.recommendedAsset);
  const bypassAiAssetCheck = shouldBypassAiAssetCheck();

  if (!ACCEPTED_SMOKE_TEST_ASSETS.has(normalizedAsset)) {
    throw new Error(
      `AI intent returned unsupported asset "${intent.recommendedAsset}". Supported smoke-test assets: ${Array.from(ACCEPTED_SMOKE_TEST_ASSETS).join(", ")}.`
    );
  }

  if (bypassAiAssetCheck) {
    console.log(`AI asset check bypassed for smoke test. Backend recommended ${intent.recommendedAsset}.`);
  } else if (normalizedAsset !== "HSK" && normalizedAsset !== "HASHKEY") {
    throw new Error(`AI intent mismatch. Expected HSK or HashKey for settlement demo, got ${intent.recommendedAsset}`);
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
