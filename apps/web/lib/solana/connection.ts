import type { Connection } from "@solana/web3.js";

export function browserRpcUrl() {
  return typeof window === "undefined"
    ? "http://localhost:3000/api/rpc"
    : new URL("/api/rpc", window.location.origin).toString();
}

export async function confirmSignature(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = value[0];
    if (status?.err)
      throw new Error(
        "The transaction failed on-chain. No successful payment has been recorded.",
      );
    if (status?.confirmationStatus === "finalized") return;
    if (
      !status &&
      (await connection.getBlockHeight("confirmed")) > lastValidBlockHeight
    )
      throw new Error(
        "Transaction expired. Check its receipt before preparing a replacement payment.",
      );
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(
    "Final confirmation is taking longer than expected. Use Check payment status; avoid sending again.",
  );
}

export function explorerUrl(
  signature: string,
  cluster: "devnet" | "mainnet-beta",
) {
  const url = new URL(`/tx/${signature}`, "https://explorer.solana.com");
  if (cluster !== "mainnet-beta") url.searchParams.set("cluster", cluster);
  return url.toString();
}
