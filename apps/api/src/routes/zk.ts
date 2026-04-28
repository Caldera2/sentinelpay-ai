import { Router } from "express";
import { z } from "zod";
import { getNexaIdStatus, verifyCredential } from "../services/nexaIdService";

const router = Router();

router.get("/status/:walletAddress", async (request, response) => {
  try {
    const walletAddress = z.string().parse(request.params.walletAddress);
    const user = await getNexaIdStatus(walletAddress);

    response.json({
      walletAddress,
      verified: user?.hasNexaId ?? false,
      proofHash: user?.lastProofHash ?? null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid wallet address.";
    response.status(400).json({ error: message });
  }
});

router.post("/verify", async (request, response) => {
  try {
    const schema = z.object({
      walletAddress: z.string()
    });

    const { walletAddress } = schema.parse(request.body);
    const result = await verifyCredential(walletAddress);

    response.json({
      verified: true,
      proofHash: result.proofHash,
      message: "NexaID credential verified with a mocked zero-knowledge proof."
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to verify NexaID credential.";
    response.status(400).json({ error: message });
  }
});

export const zkRouter = router;
