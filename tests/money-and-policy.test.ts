import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeBase58,
  formatUsdc,
  parseUsdc,
  suggestPaymentStrategy,
} from "../packages/shared/src";
import { PublicKey } from "@solana/web3.js";
import { randomBytes } from "node:crypto";
import { readEnv } from "../apps/api/src/lib/env";

test("USDC conversion uses exact base units, including six decimals", () => {
  assert.equal(parseUsdc("24.99"), 24990000n);
  assert.equal(parseUsdc("0.000001"), 1n);
  assert.equal(formatUsdc(parseUsdc("999999.999999")), "999999.999999");
  for (const amount of [
    "-1",
    "0",
    "1e6",
    "NaN",
    "Infinity",
    "1.0000001",
    "01",
    "1000000.000001",
    " 1",
  ])
    assert.throws(() => parseUsdc(amount), amount);
});
test("transaction signature encoding preserves Base58 leading zeros and case", () => {
  assert.equal(encodeBase58(Uint8Array.from([0, 0, 1])), "112");
  assert.equal(encodeBase58(Uint8Array.from([255])), "5Q");
  for (let index = 0; index < 20; index++) {
    const bytes = randomBytes(32);
    assert.equal(encodeBase58(bytes), new PublicKey(bytes).toBase58());
  }
});
test("treasury policy protects reserves and expenses and never allocates unavailable cash", () => {
  const base = {
    availableUsdcAtomic: "100000000",
    reserveAtomic: "60000000",
    upcomingExpensesAtomic: "20000000",
    liquidBps: 0,
  };
  assert.equal(
    suggestPaymentStrategy(base).suggestedAllocationAtomic,
    "20000000",
  );
  assert.equal(
    suggestPaymentStrategy({ ...base, upcomingExpensesAtomic: "50000000" })
      .suggestedAllocationAtomic,
    "0",
  );
  assert.equal(
    suggestPaymentStrategy({ ...base, liquidBps: 10000 })
      .suggestedAllocationAtomic,
    "0",
  );
  assert.equal(
    suggestPaymentStrategy({ ...base, liquidBps: 9000 })
      .suggestedAllocationAtomic,
    "10000000",
  );
  assert.throws(() => suggestPaymentStrategy({ ...base, liquidBps: NaN }));
  assert.throws(() => suggestPaymentStrategy({ ...base, liquidBps: -1 }));
});
test("production fails closed without database, RPC, HTTPS origin and proxy credentials", () => {
  assert.throws(
    () => readEnv({ NODE_ENV: "production" }),
    /HTTPS|DATABASE_URL/,
  );
  assert.throws(
    () =>
      readEnv({ NODE_ENV: "production", APP_ORIGIN: "https://shop.example" }),
    /DATABASE_URL/,
  );
  assert.throws(
    () =>
      readEnv({
        NODE_ENV: "production",
        APP_ORIGIN: "https://shop.example",
        DATABASE_URL: "postgres://test",
      }),
    /SOLANA_RPC_URL/,
  );
  assert.throws(
    () =>
      readEnv({
        NODE_ENV: "production",
        APP_ORIGIN: "https://shop.example",
        DATABASE_URL: "postgres://test",
        SOLANA_RPC_URL: "https://rpc.example",
      }),
    /API_PROXY_SECRET/,
  );
  assert.equal(readEnv({ NODE_ENV: "test" }).cluster, "devnet");
  assert.throws(
    () => readEnv({ NODE_ENV: "test", TREASURY_ENABLED: "true" }),
    /Treasury/,
  );
});
