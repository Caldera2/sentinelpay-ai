import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyReceipt,
  type ReceiptExpectation,
} from "../apps/api/src/services/chain";
import { config, signingWallet, transaction } from "./helpers";
function expected(): ReceiptExpectation {
  return {
    payer: signingWallet().address,
    merchant: signingWallet().address,
    mint: config.usdcMint,
    amountAtomic: "24990000",
    memo: "sentinelpay:invoice:attempt",
    blockhash: "blockhash",
    createdAt: new Date(Date.now() - 60000),
    expiresAt: new Date(Date.now() + 60000),
  };
}

test("finalized receipt requires the exact merchant USDC credit and invoice memo", () => {
  const value = expected();
  assert.equal(
    verifyReceipt(transaction(value), value).receivedAtomic,
    "24990000",
  );
  assert.throws(
    () => verifyReceipt(transaction(value, "24989999"), value),
    /full invoice amount/,
  );
  assert.throws(
    () =>
      verifyReceipt(transaction(value), { ...value, memo: "another invoice" }),
    /does not reference/,
  );
  assert.throws(
    () =>
      verifyReceipt(transaction(value), {
        ...value,
        payer: signingWallet().address,
      }),
    /did not sign/,
  );
  assert.throws(
    () =>
      verifyReceipt(transaction(value), {
        ...value,
        merchant: signingWallet().address,
      }),
    /account is missing/,
  );
});
test("failed, missing and unrelated-blockhash transactions cannot become successful receipts", () => {
  const value = expected(),
    failed = transaction(value);
  failed.meta!.err = { InstructionError: [0, "InvalidArgument"] };
  assert.throws(() => verifyReceipt(failed, value), /transaction failed/);
  assert.throws(
    () => verifyReceipt(null, value),
    /awaiting final confirmation/,
  );
  assert.throws(
    () =>
      verifyReceipt(transaction(value), {
        ...value,
        blockhash: "different blockhash",
      }),
    /blockhash/,
  );
  assert.throws(
    () =>
      verifyReceipt(transaction(value), {
        ...value,
        createdAt: new Date(Date.now() + 60000),
      }),
    /time window/,
  );
  assert.equal(
    verifyReceipt(transaction(value), {
      ...value,
      expiresAt: new Date(Date.now() - 60000),
    }).paidLate,
    true,
  );
});
test("token mint, decimal and owner mismatches are rejected", () => {
  const value = expected();
  const wrongMint = transaction(value);
  wrongMint.meta!.postTokenBalances![0].mint = signingWallet().address;
  assert.throws(() => verifyReceipt(wrongMint, value), /full invoice amount/);
  const wrongDecimals = transaction(value);
  wrongDecimals.meta!.postTokenBalances![0].uiTokenAmount.decimals = 9;
  assert.throws(
    () => verifyReceipt(wrongDecimals, value),
    /full invoice amount/,
  );
  const wrongOwner = transaction(value);
  wrongOwner.meta!.postTokenBalances![0].owner = signingWallet().address;
  assert.throws(() => verifyReceipt(wrongOwner, value), /full invoice amount/);
});
