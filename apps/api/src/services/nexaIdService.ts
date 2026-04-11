import { keccak256, toUtf8Bytes } from "ethers";
import { getUserByWallet, upsertUser } from "../lib/db";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getNexaIdStatus(walletAddress: string) {
  return getUserByWallet(walletAddress);
}

export async function verifyCredential(walletAddress: string) {
  await sleep(2_000);

  const proofHash = keccak256(toUtf8Bytes(`NEXAID_VERIFIED${walletAddress}`));
  const holdsRwa = Number.parseInt(walletAddress.slice(-2), 16) % 2 === 0;

  const user = await upsertUser(walletAddress, {
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

