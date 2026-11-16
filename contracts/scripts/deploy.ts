import hre from "hardhat";
import { getAddress } from "ethers";

async function main() {
  if (process.env.ENABLE_LEGACY_DEPLOYMENT !== "true")
    throw new Error(
      "Legacy deployment is disabled. Review the archived EVM design before explicitly enabling it.",
    );
  if (
    !process.env.LEGACY_RPC_URL ||
    !process.env.RWA_VAULT_ADDRESS ||
    !process.env.PRIVATE_KEY
  )
    throw new Error(
      "Legacy RPC, reviewed vault address, and a new private key are required.",
    );
  const vault = getAddress(process.env.RWA_VAULT_ADDRESS);
  const { ethers } = await hre.network.create();
  const [deployer] = await ethers.getSigners();
  const factory = await ethers.getContractFactory(
    "SentinelPaySettlementEngine",
  );
  const engine = await factory.deploy(deployer.address, vault, 0);
  await engine.waitForDeployment();
  console.log(
    `Legacy EVM engine deployed at ${await engine.getAddress()}; allocation starts disabled.`,
  );
}
void main().catch(() => {
  console.error(
    "Legacy deployment failed. Check configuration and network access.",
  );
  process.exitCode = 1;
});
