import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { getUserByWallet, upsertUser } from "../lib/db";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getNexaIdStatus(walletAddress: string) {
  return getUserByWallet(walletAddress);
}

export async function verifyCredential(walletAddress: string) {
  await sleep(2_000);

  const normalizedAddress = new PublicKey(walletAddress).toBase58();
  const proofHash = createHash("sha256").update(`NEXAID_VERIFIED:${normalizedAddress}`).digest("hex");
  const walletBytes = new PublicKey(normalizedAddress).toBytes();
  const holdsRwa = walletBytes[walletBytes.length - 1] % 2 === 0;

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
