import { Router } from "express";
import { buildMockWalletSnapshot, suggestPaymentStrategy } from "@sentinelpay/shared";
import { z } from "zod";
import { getUserByWallet, upsertUser } from "../lib/db";
import { verifyJwt } from "../lib/jwt";

const router = Router();

function getAuthorizedWallet(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  try {
    const payload = verifyJwt(header.replace("Bearer ", ""));
    return payload.walletAddress;
  } catch {
    return null;
  }
}

router.post("/intent", async (request, response) => {
  const schema = z.object({
    walletAddress: z.string(),
    demoBypass: z.boolean().optional()
  });

  const { walletAddress, demoBypass } = schema.parse(request.body);

  if (!demoBypass) {
    const authorizedWallet = getAuthorizedWallet(request.headers.authorization);

    if (!authorizedWallet) {
      return response.status(401).json({ error: "Missing or invalid session token." });
    }

    if (authorizedWallet.toLowerCase() !== walletAddress.toLowerCase()) {
      return response.status(403).json({ error: "Wallet mismatch for secured AI intent request." });
    }
  }

  const user = await getUserByWallet(walletAddress);
  const snapshot = buildMockWalletSnapshot(walletAddress, user?.hasNexaId ?? false);
  const paymentIntent = suggestPaymentStrategy(snapshot);

  return response.json({
    ...paymentIntent,
    mockApi: true
  });
});

export const aiRouter = router;
