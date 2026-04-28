import type { QuoteResponse } from "@jup-ag/api";
import { QuoteGetSwapModeEnum, createJupiterApiClient } from "@jup-ag/api";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

type PrepareJupiterPaymentArgs = {
  inputToken: string;
  targetAmountUsdc: number;
  merchantAddress: string;
  userPublicKey: string;
  usdcMint: string;
  slippageBps?: number;
};

type GetJupiterQuoteArgs = {
  inputMint: string;
  outputMint: string;
  amountAtomic: number;
  slippageBps?: number;
};

const jupiterApi = createJupiterApiClient();

function toAtomicAmount(amount: number, decimals: number) {
  return Math.round(amount * 10 ** decimals);
}

function decodeBase64Transaction(serializedTransaction: string) {
  return VersionedTransaction.deserialize(Buffer.from(serializedTransaction, "base64"));
}

function validateJupiterQuoteLiquidity(quote: QuoteResponse) {
  const rawImpact = Number(quote.priceImpactPct ?? 0);

  if (!Number.isFinite(rawImpact)) {
    return;
  }

  // Jupiter may return either a decimal fraction or a percentage-like number.
  const normalizedPct = rawImpact <= 1 ? rawImpact * 100 : rawImpact;

  if (normalizedPct > 1) {
    throw new Error("Low Liquidity: price impact exceeds 1% for this swap route.");
  }
}

export async function getJupiterQuote({
  inputMint,
  outputMint,
  amountAtomic,
  slippageBps = 50
}: GetJupiterQuoteArgs) {
  const quote = await jupiterApi.quoteGet({
    inputMint,
    outputMint,
    amount: amountAtomic,
    slippageBps,
    swapMode: QuoteGetSwapModeEnum.ExactOut
  });

  validateJupiterQuoteLiquidity(quote);
  return quote;
}

export async function getJupiterSwapInstructions(args: {
  quoteResponse: QuoteResponse;
  userPublicKey: string;
  destinationTokenAccount?: string;
}) {
  return jupiterApi.swapInstructionsPost({
    swapRequest: {
      quoteResponse: args.quoteResponse,
      userPublicKey: args.userPublicKey,
      wrapAndUnwrapSol: true,
      useSharedAccounts: true,
      dynamicComputeUnitLimit: true,
      destinationTokenAccount: args.destinationTokenAccount
    }
  });
}

export async function prepareJupiterPayment({
  inputToken,
  targetAmountUsdc,
  merchantAddress,
  userPublicKey,
  usdcMint,
  slippageBps = 50
}: PrepareJupiterPaymentArgs) {
  const merchantUsdcAta = getAssociatedTokenAddressSync(new PublicKey(usdcMint), new PublicKey(merchantAddress));

  const quote = await getJupiterQuote({
    inputMint: inputToken,
    outputMint: usdcMint,
    amountAtomic: toAtomicAmount(targetAmountUsdc, 6),
    slippageBps
  });

  const swap = await jupiterApi.swapPost({
    swapRequest: {
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      useSharedAccounts: true,
      dynamicComputeUnitLimit: true,
      destinationTokenAccount: merchantUsdcAta.toBase58()
    }
  });

  if (!swap.swapTransaction) {
    throw new Error("Jupiter did not return a swap transaction.");
  }

  return decodeBase64Transaction(swap.swapTransaction);
}
