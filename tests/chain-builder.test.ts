import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SOLANA_NETWORKS } from "../packages/shared/src";
import {
  createChain,
  MEMO_PROGRAM,
  paymentReference,
} from "../apps/api/src/services/chain";
import { config, signingWallet } from "./helpers";
let server: Server, url: string;
let genesis: string = SOLANA_NETWORKS.devnet.genesisHash;
const blockhash = signingWallet().address;
before(async () => {
  server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text) as { method: string; id: number };
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result:
          body.method === "getGenesisHash"
            ? genesis
            : {
                context: { slot: 1 },
                value: { blockhash, lastValidBlockHeight: 1000 },
              },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
test("RPC checks compare the full genesis hash and reject a different network", async () => {
  genesis = SOLANA_NETWORKS.devnet.genesisHash;
  await createChain({ ...config, rpcUrl: url }).assertNetwork();
  await assert.rejects(
    createChain({
      ...config,
      rpcUrl: url,
      cluster: "mainnet-beta",
    }).assertNetwork(),
    /does not match/,
  );
  genesis = SOLANA_NETWORKS.devnet.caip2.split(":")[1];
  await assert.rejects(
    createChain({ ...config, rpcUrl: url }).assertNetwork(),
    /does not match/,
  );
  genesis = SOLANA_NETWORKS.devnet.genesisHash;
});
test("direct checkout is one versioned transaction with the exact USDC transfer and tracking reference", async () => {
  const payer = signingWallet().address,
    merchant = signingWallet().address,
    memo = "sentinelpay:test:attempt";
  const built = await createChain({ ...config, rpcUrl: url }).buildPayment({
    payer,
    merchant,
    mint: config.usdcMint,
    amountAtomic: "24990000",
    memo,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
  });
  const tx = VersionedTransaction.deserialize(
    Buffer.from(built.transaction, "base64"),
  );
  assert.equal(tx.message.recentBlockhash, blockhash);
  assert.equal(tx.message.header.numRequiredSignatures, 1);
  const keys = tx.message.staticAccountKeys;
  const transfer = tx.message.compiledInstructions.find((instruction) =>
    keys[instruction.programIdIndex].equals(TOKEN_PROGRAM_ID),
  )!;
  assert.equal(Buffer.from(transfer.data).readBigUInt64LE(1), 24990000n);
  assert.equal(transfer.data[9], 6);
  const recipient = getAssociatedTokenAddressSync(
    new PublicKey(config.usdcMint),
    new PublicKey(merchant),
  );
  assert.ok(keys[transfer.accountKeyIndexes[2]].equals(recipient));
  const reference = keys.findIndex((key) => key.equals(paymentReference(memo)));
  assert.ok(reference >= 0);
  assert.equal(tx.message.isAccountSigner(reference), false);
  assert.equal(tx.message.isAccountWritable(reference), false);
  const memoInstruction = tx.message.compiledInstructions.find((instruction) =>
    keys[instruction.programIdIndex].equals(MEMO_PROGRAM),
  )!;
  assert.equal(Buffer.from(memoInstruction.data).toString(), memo);
});
