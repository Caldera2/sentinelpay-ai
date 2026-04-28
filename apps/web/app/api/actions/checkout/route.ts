import { createPostResponse } from "@solana/actions";
import type { ActionGetResponse, ActionPostRequest } from "@solana/actions-spec";
import type { Instruction } from "@jup-ag/api";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import {
  AddressLookupTableAccount,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";
import {
  getSolanaMerchantAddress,
  getSolanaRwaMintAddress,
  getSolanaUsdcMintAddress,
  requirePublicKey
} from "../../../../lib/solana/config";
import { SentinelConnection } from "../../../../lib/solana/connection";
import { getJupiterQuote, getJupiterSwapInstructions } from "../../../../lib/solana/jupiter";

const solanaConnection = SentinelConnection.getInstance();

const PRODUCT_PRICE_USDC = 24.99;
const USDC_DECIMALS = 6;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function svgIconDataUri() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#22d3ee" />
          <stop offset="100%" stop-color="#34d399" />
        </linearGradient>
      </defs>
      <rect width="320" height="320" rx="48" fill="#07111f" />
      <rect x="22" y="22" width="276" height="276" rx="40" fill="url(#bg)" opacity="0.15" />
      <text x="38" y="120" fill="#f8fbff" font-size="40" font-family="Arial, sans-serif">SentinelPay</text>
      <text x="38" y="170" fill="#a5f3fc" font-size="22" font-family="Arial, sans-serif">Blink Checkout</text>
      <text x="38" y="222" fill="#bbf7d0" font-size="34" font-family="Arial, sans-serif">$24.99 USDC</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const actionUrl = new URL("/api/actions/checkout", url.origin).toString();

  const payload: ActionGetResponse = {
    type: "action",
    icon: svgIconDataUri(),
    title: "SentinelPay Solana Checkout",
    description: "Pay a SentinelPay product in USDC on Solana, ready for Blink rendering on X and wallet surfaces.",
    label: `Pay ${PRODUCT_PRICE_USDC.toFixed(2)} USDC`,
    links: {
      actions: [
        {
          type: "transaction",
          href: `${actionUrl}?amount=${PRODUCT_PRICE_USDC}&inputMint=${getSolanaUsdcMintAddress()}&yieldPct=0`,
          label: "Checkout with SentinelPay"
        }
      ]
    }
  };

  return Response.json(payload, {
    headers: corsHeaders()
  });
}

type CheckoutActionRequest = ActionPostRequest & {
  data?: {
    amountUsdc?: number | string;
    inputMint?: string;
    yieldPct?: number | string;
    slippageBps?: number | string;
  };
};

function toAtomicUsdcAmount(amount: number) {
  return Math.round(amount * 10 ** USDC_DECIMALS);
}

function parseNumber(value: string | number | undefined | null, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value));
}

function instructionFromApi(instruction: Instruction) {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programId),
    keys: instruction.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable
    })),
    data: Buffer.from(instruction.data, "base64")
  });
}

async function fetchLookupTableAccounts(addresses: string[]) {
  if (!addresses.length) {
    return [] as AddressLookupTableAccount[];
  }

  const tableAccounts = await Promise.all(
    addresses.map(async (address) => {
      const table = await solanaConnection.getAddressLookupTable(new PublicKey(address));
      return table.value;
    })
  );

  return tableAccounts.filter((table): table is AddressLookupTableAccount => Boolean(table));
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const body = (await request.json()) as CheckoutActionRequest;
    const amountUsdc = parseNumber(
      body.data?.amountUsdc ?? url.searchParams.get("amount"),
      PRODUCT_PRICE_USDC
    );
    const yieldPct = clampPercentage(
      parseNumber(body.data?.yieldPct ?? url.searchParams.get("yieldPct"), 0)
    );
    const slippageBps = Math.max(1, Math.round(parseNumber(body.data?.slippageBps, 50)));
    const payer = requirePublicKey(body.account, "Blink payer");
    const merchant = requirePublicKey(getSolanaMerchantAddress(), "Solana merchant treasury");
    const usdcMint = requirePublicKey(getSolanaUsdcMintAddress(), "Solana USDC mint");
    const inputMint = requirePublicKey(
      body.data?.inputMint ?? url.searchParams.get("inputMint") ?? usdcMint.toBase58(),
      "Input token mint"
    );

    const merchantUsdcAta = getAssociatedTokenAddressSync(usdcMint, merchant);
    const payerUsdcAta = getAssociatedTokenAddressSync(usdcMint, payer);

    const quote = await getJupiterQuote({
      inputMint: inputMint.toBase58(),
      outputMint: usdcMint.toBase58(),
      amountAtomic: toAtomicUsdcAmount(amountUsdc),
      slippageBps
    });

    const swapInstructionsResponse = await getJupiterSwapInstructions({
      quoteResponse: quote,
      userPublicKey: payer.toBase58(),
      destinationTokenAccount: merchantUsdcAta.toBase58()
    });

    const instructions: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(payer, payerUsdcAta, payer, usdcMint),
      createAssociatedTokenAccountIdempotentInstruction(payer, merchantUsdcAta, merchant, usdcMint),
      ...swapInstructionsResponse.computeBudgetInstructions.map(instructionFromApi),
      ...swapInstructionsResponse.setupInstructions.map(instructionFromApi),
      ...swapInstructionsResponse.otherInstructions.map(instructionFromApi),
      instructionFromApi(swapInstructionsResponse.swapInstruction)
    ];

    if (swapInstructionsResponse.cleanupInstruction) {
      instructions.push(instructionFromApi(swapInstructionsResponse.cleanupInstruction));
    }

    if (yieldPct > 0) {
      const rwaMint = requirePublicKey(getSolanaRwaMintAddress(), "SOLANA_RWA_MINT");
      const rwaUsdcVaultAta = getAssociatedTokenAddressSync(usdcMint, rwaMint, true);
      const yieldAtomic = Math.round((toAtomicUsdcAmount(amountUsdc) * yieldPct) / 100);

      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(payer, rwaUsdcVaultAta, rwaMint, usdcMint)
      );
      instructions.push(
        createTransferCheckedInstruction(
          payerUsdcAta,
          usdcMint,
          rwaUsdcVaultAta,
          payer,
          BigInt(yieldAtomic),
          USDC_DECIMALS
        )
      );
    }

    const lookupTableAccounts = await fetchLookupTableAccounts(
      swapInstructionsResponse.addressLookupTableAddresses
    );
    const latestBlockhash = await solanaConnection.getLatestBlockhash("confirmed");

    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: latestBlockhash.blockhash,
      instructions
    }).compileToV0Message(lookupTableAccounts);

    const transaction = new VersionedTransaction(message);

    const response = await createPostResponse({
      fields: {
        type: "transaction",
        transaction,
        message:
          yieldPct > 0
            ? `Swap-to-pay ${amountUsdc.toFixed(2)} USDC with ${yieldPct.toFixed(0)}% yield allocation`
            : `Swap-to-pay ${amountUsdc.toFixed(2)} USDC to SentinelPay treasury`
      }
    });

    return Response.json(response, {
      headers: corsHeaders()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to build SentinelPay checkout action.";
    return Response.json(
      {
        message,
        error: message
      },
      {
        status: 400,
        headers: corsHeaders()
      }
    );
  }
}
