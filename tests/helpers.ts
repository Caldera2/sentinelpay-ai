import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { createDatabase, migrate } from "../apps/api/src/lib/db";
import { readEnv } from "../apps/api/src/lib/env";
import {
  MEMO_PROGRAM,
  paymentReference,
  verifyReceipt,
  type Chain,
  type ReceiptExpectation,
} from "../apps/api/src/services/chain";

export const config = readEnv({
  NODE_ENV: "test",
  APP_ORIGIN: "http://localhost:3000",
  SOLANA_CLUSTER: "devnet",
  DATA_DIR: "memory://",
  ...(process.env.TEST_DATABASE_URL
    ? { DATABASE_URL: process.env.TEST_DATABASE_URL }
    : {}),
});
export function signingWallet() {
  const keys = generateKeyPairSync("ed25519");
  const publicBytes = keys.publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  return {
    address: new PublicKey(publicBytes).toBase58(),
    sign: (message: string) =>
      sign(null, Buffer.from(message), keys.privateKey).toString("base64"),
  };
}
export async function database(initialize = true) {
  if (!config.databaseUrl) {
    const db = createDatabase(config);
    if(initialize)await migrate(db);
    return db;
  }
  const schema = `sp_test_${randomUUID().replace(/-/g, "")}`;
  if (!/^sp_test_[a-f0-9]{32}$/.test(schema))
    throw new Error("Invalid test schema.");
  const admin = createDatabase(config);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const db = createDatabase({ ...config, schema });
  if(initialize)await migrate(db);
  return {
    ...db,
    close: async () => {
      await db.close();
      try {
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.close();
      }
    },
  };
}
export function transaction(
  expected: ReceiptExpectation,
  received = expected.amountAtomic,
): ParsedTransactionWithMeta {
  const ata = getAssociatedTokenAddressSync(
    new PublicKey(expected.mint),
    new PublicKey(expected.merchant),
  );
  const tokenBalance = (amount: string) => ({
    accountIndex: 1,
    mint: expected.mint,
    owner: expected.merchant,
    uiTokenAmount: {
      amount,
      decimals: 6,
      uiAmount: null,
      uiAmountString: amount,
    },
  });
  return {
    blockTime: Math.floor(Date.now() / 1000),
    slot: 1,
    transaction: {
      signatures: [],
      message: {
        accountKeys: [
          {
            pubkey: new PublicKey(expected.payer),
            signer: true,
            writable: true,
          },
          { pubkey: ata, signer: false, writable: true },
          {
            pubkey: paymentReference(expected.memo),
            signer: false,
            writable: false,
          },
        ],
        instructions: [
          {
            programId: MEMO_PROGRAM,
            program: "spl-memo",
            parsed: expected.memo,
          },
        ],
        recentBlockhash: "blockhash",
      },
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [10000, 0],
      postBalances: [5000, 0],
      preTokenBalances: [tokenBalance("0")],
      postTokenBalances: [tokenBalance(received)],
    },
  } as ParsedTransactionWithMeta;
}
export function testChain(): Chain & {
  receipts: Map<string, ParsedTransactionWithMeta | null>;
  built: ReceiptExpectation[];
} {
  const receipts = new Map<string, ParsedTransactionWithMeta | null>();
  const built: ReceiptExpectation[] = [];
  return {
    receipts,
    built,
    assertNetwork: async () => {},
    balance: async () => "100000000",
    async buildPayment(expected) {
      built.push(expected);
      return {
        transaction: Buffer.from("unsigned fixture").toString("base64"),
        blockhash: "blockhash",
        lastValidBlockHeight: 1000,
      };
    },
    async receipt(signature, expected) {
      return verifyReceipt(receipts.get(signature) || null, expected);
    },
    async buildTreasury() {
      throw new Error("Treasury provider is not enabled in tests.");
    },
    async tradeReceipt() {
      throw new Error("Treasury provider is not enabled in tests.");
    },
    async blockHeight() {
      return 1001;
    },
    async findReceipts() {
      return [];
    },
    async expiredUnlanded() {
      return false;
    },
    async rpc() {
      return { jsonrpc: "2.0", id: 1, result: null };
    },
  };
}
