import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { Database } from "../apps/api/src/lib/db";
import {
  MEMO_PROGRAM,
  verifyTradeReceipt,
  type TradeExpectation,
} from "../apps/api/src/services/chain";
import { createTreasuryService } from "../apps/api/src/services/treasuryService";
import { config, database, signingWallet, testChain } from "./helpers";
let db: Database;
before(async () => {
  db = await database();
});
after(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query("TRUNCATE merchants CASCADE");
});
function tradeTransaction(
  value: TradeExpectation,
  received = value.minimumOutputAtomic,
): ParsedTransactionWithMeta {
  const input = getAssociatedTokenAddressSync(
    new PublicKey(value.inputMint),
    new PublicKey(value.wallet),
  );
  const output = getAssociatedTokenAddressSync(
    new PublicKey(value.outputMint),
    new PublicKey(value.wallet),
  );
  const balance = (index: number, mint: string, amount: string) => ({
    accountIndex: index,
    mint,
    owner: value.wallet,
    uiTokenAmount: {
      amount,
      decimals: 6,
      uiAmount: null,
      uiAmountString: amount,
    },
  });
  return {
    slot: 1,
    blockTime: Math.floor(Date.now() / 1000),
    transaction: {
      signatures: [],
      message: {
        accountKeys: [
          { pubkey: new PublicKey(value.wallet), signer: true, writable: true },
          { pubkey: input, signer: false, writable: true },
          { pubkey: output, signer: false, writable: true },
        ],
        recentBlockhash: value.blockhash,
        instructions: [
          { programId: MEMO_PROGRAM, program: "spl-memo", parsed: value.memo },
        ],
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [10000, 0, 0],
      postBalances: [5000, 0, 0],
      preTokenBalances: [balance(1, value.inputMint, "100000000")],
      postTokenBalances: [
        balance(
          1,
          value.inputMint,
          (100000000n - BigInt(value.amountAtomic)).toString(),
        ),
        balance(2, value.outputMint, received),
      ],
    },
  } as ParsedTransactionWithMeta;
}
async function setup() {
  const wallet = signingWallet().address,
    rwaMint = signingWallet().address,
    chain = testChain();
  await db.query(
    "INSERT INTO merchants(wallet,liquid_bps,reserve_atomic,expenses_atomic,eligibility_acknowledged) VALUES($1,7000,60000000,20000000,true)",
    [wallet],
  );
  let last: TradeExpectation | undefined;
  chain.buildTreasury = async (
    owner,
    inputMint,
    outputMint,
    amountAtomic,
    memo,
  ) => {
    last = {
      wallet: owner,
      inputMint,
      outputMint,
      amountAtomic,
      minimumOutputAtomic: "19000000",
      memo,
      blockhash: "trade-blockhash",
      createdAt: new Date(),
    };
    return {
      transaction: "unsigned",
      blockhash: "trade-blockhash",
      lastValidBlockHeight: 1000,
      minimumOutputAtomic: "19000000",
    };
  };
  chain.tradeReceipt = async (_signature, expected) =>
    verifyTradeReceipt(tradeTransaction(expected), expected);
  const enabled = {
    ...config,
    cluster: "mainnet-beta" as const,
    treasuryEnabled: true,
    rwaMint,
    jupiterApiKey: "test-only-provider-placeholder",
  };
  return {
    wallet,
    rwaMint,
    chain,
    service: createTreasuryService(db, chain, enabled),
    last: () => last,
  };
}
test("treasury receipt independently verifies signer, memo, input debit and minimum output", () => {
  const wallet = signingWallet().address,
    value: TradeExpectation = {
      wallet,
      inputMint: config.usdcMint,
      outputMint: signingWallet().address,
      amountAtomic: "20000000",
      minimumOutputAtomic: "19000000",
      memo: "trade",
      blockhash: "trade-blockhash",
      createdAt: new Date(Date.now() - 60000),
    };
  assert.equal(
    verifyTradeReceipt(tradeTransaction(value), value).receivedAtomic,
    "19000000",
  );
  assert.throws(
    () => verifyTradeReceipt(tradeTransaction(value, "1"), value),
    /below the approved minimum/,
  );
  assert.throws(
    () =>
      verifyTradeReceipt(tradeTransaction(value), {
        ...value,
        amountAtomic: "30000000",
      }),
    /debit/,
  );
  assert.throws(
    () =>
      verifyTradeReceipt(tradeTransaction(value), {
        ...value,
        memo: "another request",
      }),
    /does not match/,
  );
});
test("allocation obeys saved reserves and allows at most one unresolved trade", async () => {
  const { wallet, service, last } = await setup();
  await assert.rejects(
    service.prepare(wallet, "allocate", randomUUID(), "30000000"),
    /cash reserve policy/,
  );
  const id = randomUUID(),
    prepared = await service.prepare(wallet, "allocate", id, "20000000");
  assert.equal(last()!.amountAtomic, "20000000");
  assert.deepEqual(
    await service.prepare(wallet, "allocate", id, "20000000"),
    prepared,
  );
  await assert.rejects(
    service.prepare(wallet, "allocate", randomUUID(), "20000000"),
  );
  assert.equal((await service.pending(wallet))!.id, id);
});
test("treasury receipts are scoped to the merchant and recorded once", async () => {
  const { wallet, service } = await setup(),
    id = randomUUID(),
    signature = "5".repeat(88);
  await service.prepare(wallet, "allocate", id);
  await assert.rejects(
    service.confirm(signingWallet().address, id, signature),
    /not found/,
  );
  await service.confirm(wallet, id, signature);
  await service.confirm(wallet, id, signature);
  assert.equal(await service.pending(wallet), null);
  assert.equal(
    (await db.query("SELECT * FROM treasury_trades WHERE status='confirmed'"))
      .rows.length,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT * FROM audit_events WHERE action='treasury.confirmed'",
      )
    ).rows.length,
    1,
  );
});
test("provider and eligibility are required, and prepared transactions cannot be discarded before expiry", async () => {
  const { wallet, service, chain } = await setup();
  const disabled = createTreasuryService(db, chain, config);
  await assert.rejects(
    disabled.prepare(wallet, "allocate", randomUUID()),
    /not configured/,
  );
  await db.query(
    "UPDATE merchants SET eligibility_acknowledged=false WHERE wallet=$1",
    [wallet],
  );
  await assert.rejects(
    service.prepare(wallet, "allocate", randomUUID()),
    /eligibility/,
  );
  await db.query(
    "UPDATE merchants SET eligibility_acknowledged=true WHERE wallet=$1",
    [wallet],
  );
  const id = randomUUID();
  await service.prepare(wallet, "allocate", id);
  chain.blockHeight = async () => 999;
  await assert.rejects(service.expire(wallet, id), /still valid/);
  chain.blockHeight = async () => 1001;
  await service.expire(wallet, id);
  assert.equal(await service.pending(wallet), null);
});
