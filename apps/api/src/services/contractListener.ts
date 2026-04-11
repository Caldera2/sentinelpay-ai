import { Contract, JsonRpcProvider, formatEther } from "ethers";
import { sentinelPayAbi } from "@sentinelpay/shared";
import { env } from "../lib/env";
import { recordTransaction } from "../lib/db";

let listening = false;

export async function startSettlementListener() {
  if (listening || !env.contractAddress) {
    return;
  }

  const provider = new JsonRpcProvider(env.rpcUrl);
  const contract = new Contract(env.contractAddress, sentinelPayAbi, provider);

  contract.on("PaymentSettled", async (merchant: string, amount: bigint, track: string, event) => {
    await recordTransaction({
      walletAddress: "unknown",
      merchant,
      amount: formatEther(amount),
      track,
      txHash: event.log.transactionHash,
      status: "success",
      createdAt: new Date().toISOString()
    });

    console.log(`[SentinelPay] PaymentSettled => merchant=${merchant} amount=${formatEther(amount)} track=${track}`);
  });

  listening = true;
}
