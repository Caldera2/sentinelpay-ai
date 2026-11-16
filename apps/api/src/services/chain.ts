import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { AppConfig } from "../lib/env";
import { HttpError } from "../lib/errors";
import { createHash } from "node:crypto";
import { SOLANA_NETWORKS } from "@sentinelpay/shared";

export const MEMO_PROGRAM = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);
export const paymentReference = (memo: string) =>
  new PublicKey(createHash("sha256").update(memo).digest());
export type ReceiptExpectation = {
  payer: string;
  merchant: string;
  mint: string;
  amountAtomic: string;
  memo: string;
  createdAt: Date;
  expiresAt: Date;
  blockhash?: string;
};
export type TradeExpectation = {
  wallet: string;
  inputMint: string;
  outputMint: string;
  amountAtomic: string;
  minimumOutputAtomic: string;
  memo: string;
  blockhash: string;
  createdAt: Date;
};
export interface Chain {
  assertNetwork(): Promise<void>;
  balance(wallet: string, mint: string): Promise<string>;
  buildPayment(
    args: ReceiptExpectation & { inputMint?: string },
  ): Promise<{
    transaction: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }>;
  receipt(
    signature: string,
    expectation: ReceiptExpectation,
  ): Promise<{ receivedAtomic: string; confirmedAt: Date; paidLate: boolean }>;
  buildTreasury(
    wallet: string,
    inputMint: string,
    outputMint: string,
    amountAtomic: string,
    memo: string,
  ): Promise<{
    transaction: string;
    blockhash: string;
    lastValidBlockHeight: number;
    minimumOutputAtomic: string;
  }>;
  tradeReceipt(
    signature: string,
    expectation: TradeExpectation,
  ): Promise<{ receivedAtomic: string; confirmedAt: Date }>;
  blockHeight(): Promise<number>;
  findReceipts(reference: string): Promise<string[]>;
  expiredUnlanded(
    signature: string,
    memo: string,
    lastValidBlockHeight: number,
  ): Promise<boolean>;
  rpc(method: string, params: unknown[]): Promise<unknown>;
}

export function verifyTradeReceipt(
  tx: ParsedTransactionWithMeta | null,
  expected: TradeExpectation,
) {
  if (!tx)
    throw new HttpError(
      202,
      "Treasury transaction is awaiting final confirmation.",
    );
  if (!tx.meta || tx.meta.err)
    throw new HttpError(422, "Treasury transaction failed on-chain.");
  const message = tx.transaction.message;
  if (
    message.recentBlockhash !== expected.blockhash ||
    !message.accountKeys.some(
      (key) => key.signer && key.pubkey.toBase58() === expected.wallet,
    )
  )
    throw new HttpError(
      422,
      "Treasury receipt has an unexpected signer or blockhash.",
    );
  if (
    !message.instructions.some(
      (instruction) =>
        "parsed" in instruction &&
        instruction.programId.equals(MEMO_PROGRAM) &&
        instruction.parsed === expected.memo,
    )
  )
    throw new HttpError(422, "Treasury receipt does not match this request.");
  if (
    !tx.blockTime ||
    tx.blockTime * 1000 < expected.createdAt.getTime() - 30_000 ||
    tx.blockTime * 1000 > Date.now() + 60_000
  )
    throw new HttpError(422, "Treasury receipt timestamp is invalid.");
  const delta = (mint: string) => {
    const ata = getAssociatedTokenAddressSync(
      new PublicKey(mint),
      new PublicKey(expected.wallet),
    );
    const index = message.accountKeys.findIndex((key) =>
      key.pubkey.equals(ata),
    );
    if (index < 0)
      throw new HttpError(422, "Treasury token account is missing.");
    const before = tx.meta!.preTokenBalances?.find(
      (balance) => balance.accountIndex === index,
    );
    const after = tx.meta!.postTokenBalances?.find(
      (balance) => balance.accountIndex === index,
    );
    for (const balance of [before, after])
      if (
        balance &&
        (balance.owner !== expected.wallet || balance.mint !== mint)
      )
        throw new HttpError(422, "Treasury token owner or mint is invalid.");
    if (
      !after ||
      (before && before.uiTokenAmount.decimals !== after.uiTokenAmount.decimals)
    )
      throw new HttpError(422, "Treasury token balance cannot be verified.");
    return (
      BigInt(after.uiTokenAmount.amount) -
      BigInt(before?.uiTokenAmount.amount || "0")
    );
  };
  if (-delta(expected.inputMint) !== BigInt(expected.amountAtomic))
    throw new HttpError(
      422,
      "Treasury debit does not match the approved input amount.",
    );
  const received = delta(expected.outputMint);
  if (received < BigInt(expected.minimumOutputAtomic))
    throw new HttpError(
      422,
      "Treasury proceeds are below the approved minimum.",
    );
  return {
    receivedAtomic: received.toString(),
    confirmedAt: new Date(tx.blockTime * 1000),
  };
}

export function verifyReceipt(
  tx: ParsedTransactionWithMeta | null,
  expected: ReceiptExpectation,
) {
  if (!tx)
    throw new HttpError(
      202,
      "Payment is awaiting final confirmation. Check its status again shortly.",
    );
  if (!tx.meta)
    throw new HttpError(202, "Transaction metadata is not available yet.");
  const keys = tx.transaction.message.accountKeys;
  if (
    !expected.blockhash ||
    tx.transaction.message.recentBlockhash !== expected.blockhash
  )
    throw new HttpError(
      422,
      "Receipt does not match the prepared transaction blockhash.",
    );
  if (
    !keys.some((key) => key.signer && key.pubkey.toBase58() === expected.payer)
  )
    throw new HttpError(
      422,
      "The expected payer did not sign this transaction.",
    );
  const memoMatches = tx.transaction.message.instructions.some(
    (instruction) =>
      "parsed" in instruction &&
      instruction.programId.equals(MEMO_PROGRAM) &&
      instruction.parsed === expected.memo,
  );
  if (!memoMatches)
    throw new HttpError(
      422,
      "Transaction does not reference this payment attempt.",
    );
  if (!keys.some((key) => key.pubkey.equals(paymentReference(expected.memo))))
    throw new HttpError(422, "Payment tracking reference is missing.");
  if (
    !tx.blockTime ||
    tx.blockTime * 1000 < expected.createdAt.getTime() - 30_000 ||
    tx.blockTime * 1000 > Date.now() + 60_000
  )
    throw new HttpError(
      422,
      "Payment falls outside the transaction time window.",
    );
  if (tx.meta.err)
    throw new HttpError(
      422,
      "The on-chain transaction failed.",
      "TRANSACTION_FAILED",
    );
  const ata = getAssociatedTokenAddressSync(
    new PublicKey(expected.mint),
    new PublicKey(expected.merchant),
  ).toBase58();
  const index = keys.findIndex((key) => key.pubkey.toBase58() === ata);
  if (index === -1)
    throw new HttpError(422, "Merchant token account is missing.");
  const matches = (
    balance: NonNullable<
      NonNullable<typeof tx.meta>["postTokenBalances"]
    >[number],
  ) =>
    balance.accountIndex === index &&
    balance.mint === expected.mint &&
    balance.owner === expected.merchant &&
    balance.uiTokenAmount.decimals === 6;
  const preEntry = tx.meta.preTokenBalances?.find(
    (balance) => balance.accountIndex === index,
  );
  if (preEntry && !matches(preEntry))
    throw new HttpError(422, "Unable to verify the merchant opening balance.");
  const before = preEntry?.uiTokenAmount.amount || "0";
  const after = tx.meta.postTokenBalances?.find(matches)?.uiTokenAmount.amount;
  if (!after || BigInt(after) - BigInt(before) < BigInt(expected.amountAtomic))
    throw new HttpError(
      422,
      "Merchant did not receive the full invoice amount in USDC.",
    );
  return {
    receivedAtomic: (BigInt(after) - BigInt(before)).toString(),
    confirmedAt: new Date(tx.blockTime * 1000),
    paidLate: tx.blockTime * 1000 > expected.expiresAt.getTime(),
  };
}

export function createChain(config: AppConfig): Chain {
  const connection = new Connection(config.rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 45_000,
    fetch: (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
  });
  let checkedAt = 0;
  const assertNetwork = async () => {
    if (Date.now() - checkedAt < 60_000) return;
    const genesis = await connection.getGenesisHash();
    const expected = SOLANA_NETWORKS[config.cluster].genesisHash;
    if (genesis !== expected)
      throw new HttpError(
        503,
        "RPC network does not match the configured payment network.",
      );
    checkedAt = Date.now();
  };

  async function jupiterSwap(
    wallet: string,
    inputMint: string,
    outputMint: string,
    amount: string,
    mode: "ExactIn" | "ExactOut",
    memo?: string,
  ) {
    if (!config.jupiterApiKey || config.cluster !== "mainnet-beta")
      throw new HttpError(
        503,
        "Token swaps are not configured. Pay directly in USDC.",
      );
    await assertNetwork();
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": config.jupiterApiKey,
    };
    const query = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      swapMode: mode,
      slippageBps: "50",
      restrictIntermediateTokens: "true",
    });
    const quoteResponse = await fetch(
      `https://api.jup.ag/swap/v1/quote?${query}`,
      { headers, signal: AbortSignal.timeout(15_000) },
    );
    if (!quoteResponse.ok)
      throw new HttpError(
        503,
        "No supported swap route is available. Try direct USDC payment.",
      );
    const quote = (await quoteResponse.json()) as {
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      otherAmountThreshold: string;
      swapMode: string;
      priceImpactPct: string;
    };
    if (
      quote.inputMint !== inputMint ||
      quote.outputMint !== outputMint ||
      quote.swapMode !== mode ||
      (mode === "ExactOut"
        ? quote.outAmount !== amount
        : quote.inAmount !== amount)
    )
      throw new HttpError(503, "Swap provider returned a mismatched quote.");
    const impact = Number(quote.priceImpactPct);
    // Conservative: reject malformed data and impacts over 0.01 in the provider field.
    if (!Number.isFinite(impact) || impact < 0 || impact > 0.01)
      throw new HttpError(
        422,
        "Swap price impact exceeds the conservative checkout limit.",
      );
    const outputAta = getAssociatedTokenAddressSync(
      new PublicKey(outputMint),
      new PublicKey(wallet),
    );
    const swapResponse = await fetch(
      "https://api.jup.ag/swap/v1/swap-instructions",
      {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          userPublicKey: wallet,
          quoteResponse: quote,
          destinationTokenAccount: outputAta.toBase58(),
          wrapAndUnwrapSol: true,
          useSharedAccounts: false,
          dynamicComputeUnitLimit: true,
        }),
      },
    );
    if (!swapResponse.ok)
      throw new HttpError(503, "Unable to build a supported token swap.");
    type ApiInstruction = {
      programId: string;
      accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
      data: string;
    };
    const swap = (await swapResponse.json()) as {
      computeBudgetInstructions: ApiInstruction[];
      setupInstructions: ApiInstruction[];
      otherInstructions?: ApiInstruction[];
      swapInstruction: ApiInstruction;
      cleanupInstruction?: ApiInstruction;
      addressLookupTableAddresses: string[];
    };
    const instruction = (item: ApiInstruction) =>
      new TransactionInstruction({
        programId: new PublicKey(item.programId),
        keys: item.accounts.map((key) => ({
          ...key,
          pubkey: new PublicKey(key.pubkey),
        })),
        data: Buffer.from(item.data, "base64"),
      });
    const instructions = [
      ...swap.computeBudgetInstructions.map(instruction),
      createAssociatedTokenAccountIdempotentInstruction(
        new PublicKey(wallet),
        outputAta,
        new PublicKey(wallet),
        new PublicKey(outputMint),
      ),
      ...swap.setupInstructions.map(instruction),
      ...(swap.otherInstructions || []).map(instruction),
      instruction(swap.swapInstruction),
      ...(swap.cleanupInstruction
        ? [instruction(swap.cleanupInstruction)]
        : []),
    ];
    if (memo)
      instructions.push(
        new TransactionInstruction({
          programId: MEMO_PROGRAM,
          keys: [],
          data: Buffer.from(memo),
        }),
      );
    const lookupTables = await Promise.all(
      swap.addressLookupTableAddresses.map(async (address) => {
        const { value } = await connection.getAddressLookupTable(
          new PublicKey(address),
        );
        if (!value)
          throw new HttpError(503, "Swap lookup table is unavailable.");
        return value;
      }),
    );
    const latest = await connection.getLatestBlockhash("confirmed");
    if (!/^[1-9]\d{0,19}$/.test(quote.otherAmountThreshold))
      throw new HttpError(503, "Swap minimum output is invalid.");
    return {
      instructions,
      lookupTables,
      latest,
      minimumOutputAtomic: quote.otherAmountThreshold,
    };
  }

  return {
    assertNetwork,
    async balance(wallet, mint) {
      await assertNetwork();
      const ata = getAssociatedTokenAddressSync(
        new PublicKey(mint),
        new PublicKey(wallet),
      );
      const account = await connection.getAccountInfo(ata, "confirmed");
      if (!account) return "0";
      return (await connection.getTokenAccountBalance(ata, "confirmed")).value
        .amount;
    },
    async buildPayment(args) {
      await assertNetwork();
      const payer = new PublicKey(args.payer);
      const mint = new PublicKey(args.mint);
      const merchant = new PublicKey(args.merchant);
      const merchantAta = getAssociatedTokenAddressSync(mint, merchant);
      const transfer = createTransferCheckedInstruction(
        getAssociatedTokenAddressSync(mint, payer),
        mint,
        merchantAta,
        payer,
        BigInt(args.amountAtomic),
        6,
      );
      transfer.keys.push({
        pubkey: paymentReference(args.memo),
        isSigner: false,
        isWritable: false,
      });
      if (args.inputMint && args.inputMint !== args.mint) {
        const swap = await jupiterSwap(
          args.payer,
          args.inputMint,
          args.mint,
          args.amountAtomic,
          "ExactOut",
        );
        // Swap into the payer's USDC account, then transfer the exact invoice amount in this same transaction.
        swap.instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            payer,
            merchantAta,
            merchant,
            mint,
          ),
        );
        swap.instructions.push(transfer);
        swap.instructions.push(
          new TransactionInstruction({
            programId: MEMO_PROGRAM,
            keys: [],
            data: Buffer.from(args.memo),
          }),
        );
        const message = new TransactionMessage({
          payerKey: payer,
          recentBlockhash: swap.latest.blockhash,
          instructions: swap.instructions,
        }).compileToV0Message(swap.lookupTables);
        return {
          transaction: Buffer.from(
            new VersionedTransaction(message).serialize(),
          ).toString("base64"),
          ...swap.latest,
        };
      }
      const latest = await connection.getLatestBlockhash("confirmed");
      const instructions = [
        createAssociatedTokenAccountIdempotentInstruction(
          payer,
          merchantAta,
          merchant,
          mint,
        ),
        transfer,
        new TransactionInstruction({
          programId: MEMO_PROGRAM,
          keys: [],
          data: Buffer.from(args.memo),
        }),
      ];
      const message = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: latest.blockhash,
        instructions,
      }).compileToV0Message();
      return {
        transaction: Buffer.from(
          new VersionedTransaction(message).serialize(),
        ).toString("base64"),
        ...latest,
      };
    },
    async receipt(signature, expected) {
      await assertNetwork();
      return verifyReceipt(
        await connection.getParsedTransaction(signature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        }),
        expected,
      );
    },
    async buildTreasury(wallet, inputMint, outputMint, amountAtomic, memo) {
      const swap = await jupiterSwap(
        wallet,
        inputMint,
        outputMint,
        amountAtomic,
        "ExactIn",
        memo,
      );
      const message = new TransactionMessage({
        payerKey: new PublicKey(wallet),
        recentBlockhash: swap.latest.blockhash,
        instructions: swap.instructions,
      }).compileToV0Message(swap.lookupTables);
      return {
        transaction: Buffer.from(
          new VersionedTransaction(message).serialize(),
        ).toString("base64"),
        minimumOutputAtomic: swap.minimumOutputAtomic,
        ...swap.latest,
      };
    },
    async tradeReceipt(signature, expected) {
      await assertNetwork();
      return verifyTradeReceipt(
        await connection.getParsedTransaction(signature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        }),
        expected,
      );
    },
    async blockHeight() {
      await assertNetwork();
      return connection.getBlockHeight("finalized");
    },
    async findReceipts(reference) {
      await assertNetwork();
      return (
        await connection.getSignaturesForAddress(
          new PublicKey(reference),
          { limit: 10 },
          "finalized",
        )
      ).map((item) => item.signature);
    },
    async expiredUnlanded(signature, memo, lastValidBlockHeight) {
      await assertNetwork();
      const [statuses, height, references] = await Promise.all([
        connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        }),
        connection.getBlockHeight("finalized"),
        connection.getSignaturesForAddress(
          paymentReference(memo),
          { limit: 1 },
          "finalized",
        ),
      ]);
      return (
        statuses.value[0] === null &&
        height > lastValidBlockHeight &&
        references.length === 0
      );
    },
    async rpc(method, params) {
      await assertNetwork();
      const response = await fetch(config.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok)
        throw new HttpError(503, "Solana RPC is temporarily unavailable.");
      return response.json();
    },
  };
}
