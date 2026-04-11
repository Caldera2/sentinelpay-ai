import { Router } from "express";
import { getTransactions } from "../lib/db";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/history", requireAuth, async (request, response) => {
  const transactions = await getTransactions();
  const walletAddress = request.walletAddress?.toLowerCase();

  response.json({
    items: transactions.filter((item) => item.walletAddress === "unknown" || item.walletAddress.toLowerCase() === walletAddress)
  });
});

export const paymentsRouter = router;

