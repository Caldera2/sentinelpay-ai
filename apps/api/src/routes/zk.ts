import { Router } from "express";
import { z } from "zod";
import { getNexaIdStatus, verifyCredential } from "../services/nexaIdService";

const router = Router();

router.get("/status/:walletAddress", async (request, response) => {
  const walletAddress = z.string().parse(request.params.walletAddress);
  const user = await getNexaIdStatus(walletAddress);

  response.json({
    walletAddress,
    verified: user?.hasNexaId ?? false,
    proofHash: user?.lastProofHash ?? null
  });
});

router.post("/verify", async (request, response) => {
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
});

export const zkRouter = router;

