import { Router } from "express";
import { z } from "zod";
import { getTransactions, recordTransaction } from "../lib/db";
import { requireAuth } from "../middleware/auth";

const router = Router();

const transactionSchema = z.object({
  merchant: z.string(),
  amount: z.string(),
  track: z.string(),
  txHash: z.string(),
  status: z.enum(["pending", "success", "failed"]),
  createdAt: z.string().optional()
});

router.get("/history", requireAuth, async (request, response) => {
  const transactions = await getTransactions();
  const walletAddress = request.walletAddress?.toLowerCase();

  response.json({
    items: transactions.filter((item) => item.walletAddress === "unknown" || item.walletAddress.toLowerCase() === walletAddress)
  });
});

router.post("/record", requireAuth, async (request, response) => {
  const walletAddress = request.walletAddress;

  if (!walletAddress) {
    return response.status(401).json({ error: "Wallet address missing from session." });
  }

  const payload = transactionSchema.parse(request.body);
  const normalizedWalletAddress = walletAddress.toLowerCase();
  const transactions = await getTransactions();
  const existing = transactions.find((item) => item.txHash.toLowerCase() === payload.txHash.toLowerCase());

  if (existing) {
    return response.json({ item: existing });
  }

  const item = await recordTransaction({
    walletAddress: normalizedWalletAddress,
    merchant: payload.merchant,
    amount: payload.amount,
    track: payload.track,
    txHash: payload.txHash,
    status: payload.status,
    createdAt: payload.createdAt ?? new Date().toISOString()
  });

  return response.status(201).json({ item });
});

export const paymentsRouter = router;
