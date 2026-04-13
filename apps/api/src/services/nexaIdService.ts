import { getAddress, solidityPackedKeccak256 } from "ethers";
import { getUserByWallet, upsertUser } from "../lib/db";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getNexaIdStatus(walletAddress: string) {
  return getUserByWallet(walletAddress);
}

export async function verifyCredential(walletAddress: string) {
  await sleep(2_000);

  const normalizedAddress = getAddress(walletAddress);
  const proofHash = solidityPackedKeccak256(["string", "address"], ["NEXAID_VERIFIED", normalizedAddress]);
  const holdsRwa = Number.parseInt(normalizedAddress.slice(-2), 16) % 2 === 0;

  const user = await upsertUser(normalizedAddress, {
    hasNexaId: true,
    holdsRwa,
    lastProofHash: proofHash,
    loyaltyPoints: holdsRwa ? 150 : 25
  });

  return {
    status: "verified" as const,
    proofHash,
    user
  };
}
