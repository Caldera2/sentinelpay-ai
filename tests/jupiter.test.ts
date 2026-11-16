import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SOLANA_NETWORKS } from "@sentinelpay/shared";
import { createChain, paymentReference } from "../apps/api/src/services/chain";
import { config, signingWallet } from "./helpers";

async function fixture() {
  const blockhash = Keypair.generate().publicKey.toBase58();
  const server = await new Promise<Server>((resolve) => {
    const s = createServer(async (req, res) => {
      let raw = "";
      for await (const part of req) raw += part;
      const request = JSON.parse(raw);
      const result =
        request.method === "getGenesisHash"
          ? SOLANA_NETWORKS["mainnet-beta"].genesisHash
          : request.method === "getLatestBlockhash"
            ? {
                context: { slot: 100 },
                value: { blockhash, lastValidBlockHeight: 1000 },
              }
            : null;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    }).listen(0, "127.0.0.1", () => resolve(s));
  });
  const rpcUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const observations: {
    quote?: URL;
    instructions?: Record<string, unknown>;
    badQuote: boolean;
    deny: boolean;
  } = { badQuote: false, deny: false };
  const originalFetch = globalThis.fetch;
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      if (url.origin !== "https://api.jup.ag")
        return originalFetch(input, init);
      assert.equal(
        new Headers(init?.headers).get("x-api-key"),
        "automated-test-provider-key",
      );
      if (observations.deny)
        return new Response("unavailable", { status: 503 });
      if (url.pathname === "/swap/v1/quote") {
        observations.quote = url;
        const mode = url.searchParams.get("swapMode")!,
          amount = url.searchParams.get("amount")!;
        return Response.json({
          inputMint: url.searchParams.get("inputMint"),
          outputMint: url.searchParams.get("outputMint"),
          swapMode: mode,
          inAmount: mode === "ExactIn" ? amount : "250000000",
          outAmount: observations.badQuote
            ? "1"
            : mode === "ExactOut"
              ? amount
              : "1000000",
          otherAmountThreshold: mode === "ExactIn" ? "990000" : "251250000",
          priceImpactPct: "0.001",
        });
      }
      assert.equal(url.pathname, "/swap/v1/swap-instructions");
      observations.instructions = JSON.parse(init!.body as string);
      // These provider instructions exercise composition; they do not simulate a live trade.
      const instruction = ComputeBudgetProgram.setComputeUnitLimit({
        units: 200000,
      });
      return Response.json({
        computeBudgetInstructions: [],
        setupInstructions: [],
        otherInstructions: [],
        addressLookupTableAddresses: [],
        swapInstruction: {
          programId: instruction.programId.toBase58(),
          accounts: [],
          data: instruction.data.toString("base64"),
        },
      });
    },
  );
  const mint = SOLANA_NETWORKS["mainnet-beta"].usdcMint;
  const chain = createChain({
    ...config,
    cluster: "mainnet-beta",
    usdcMint: mint,
    rpcUrl,
    jupiterApiKey: "automated-test-provider-key",
    swapEnabled: true,
  });
  return {
    chain,
    observations,
    mint,
    close: async () => {
      fetchMock.mock.restore();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    },
  };
}
test("Jupiter invoice quotes preserve ExactOut and compose the exact merchant credit in one transaction", async () => {
  const f = await fixture();
  try {
    const payer = signingWallet().address,
      merchant = signingWallet().address,
      memo = "sentinelpay:automated:exact-out";
    const built = await f.chain.buildPayment({
      payer,
      merchant,
      mint: f.mint,
      amountAtomic: "24990000",
      memo,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
      inputMint: "So11111111111111111111111111111111111111112",
    });
    assert.equal(
      f.observations.quote?.searchParams.get("swapMode"),
      "ExactOut",
    );
    assert.equal(f.observations.quote?.searchParams.get("amount"), "24990000");
    assert.equal(f.observations.quote?.searchParams.get("slippageBps"), "50");
    assert.equal(
      f.observations.instructions?.destinationTokenAccount,
      getAssociatedTokenAddressSync(
        new PublicKey(f.mint),
        new PublicKey(payer),
      ).toBase58(),
    );
    const tx = VersionedTransaction.deserialize(
        Buffer.from(built.transaction, "base64"),
      ),
      keys = tx.message.staticAccountKeys;
    const transfers = tx.message.compiledInstructions.filter((i) =>
      keys[i.programIdIndex].equals(TOKEN_PROGRAM_ID),
    );
    assert.equal(transfers.length, 1);
    const transfer = transfers[0];
    assert.equal(transfer.data[0], 12);
    assert.equal(Buffer.from(transfer.data).readBigUInt64LE(1), 24990000n);
    assert.equal(transfer.data[9], 6);
    assert.ok(
      keys[transfer.accountKeyIndexes[2]].equals(
        getAssociatedTokenAddressSync(
          new PublicKey(f.mint),
          new PublicKey(merchant),
        ),
      ),
    );
    assert.ok(keys.some((key) => key.equals(paymentReference(memo))));
  } finally {
    await f.close();
  }
});
test("mismatched Jupiter quotes and provider outages fail without producing a payable transaction", async () => {
  const f = await fixture();
  try {
    const args = {
      payer: signingWallet().address,
      merchant: signingWallet().address,
      mint: f.mint,
      amountAtomic: "24990000",
      memo: "sentinelpay:bad-quote",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
      inputMint: "So11111111111111111111111111111111111111112",
    };
    f.observations.badQuote = true;
    await assert.rejects(f.chain.buildPayment(args), /mismatched quote/);
    assert.equal(f.observations.instructions, undefined);
    f.observations.badQuote = false;
    f.observations.deny = true;
    await assert.rejects(f.chain.buildPayment(args), /No supported swap route/);
  } finally {
    await f.close();
  }
});
test("treasury quotes use ExactIn and retain the provider's minimum output", async () => {
  const f = await fixture();
  try {
    const result = await f.chain.buildTreasury(
      signingWallet().address,
      f.mint,
      Keypair.generate().publicKey.toBase58(),
      "1000000",
      "sentinelpay:treasury:automated",
    );
    assert.equal(f.observations.quote?.searchParams.get("swapMode"), "ExactIn");
    assert.equal(f.observations.quote?.searchParams.get("amount"), "1000000");
    assert.equal(result.minimumOutputAtomic, "990000");
    assert.ok(
      VersionedTransaction.deserialize(
        Buffer.from(result.transaction, "base64"),
      ).message.staticAccountKeys.length > 0,
    );
  } finally {
    await f.close();
  }
});
