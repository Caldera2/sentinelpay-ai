import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Database } from "../apps/api/src/lib/db";
import { createInvoiceService } from "../apps/api/src/services/invoiceService";
import { reconcilePaymentsOnce } from "../apps/api/src/services/reconciler";
import {
  config,
  database,
  signingWallet,
  testChain,
  transaction,
} from "./helpers";
let db: Database;
before(async () => {
  db = await database();
});
after(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.query(
    "TRUNCATE merchants,auth_challenges,sessions,invoices,payment_attempts,audit_events RESTART IDENTITY CASCADE",
  );
});
async function setup() {
  const merchant = signingWallet().address,
    payer = signingWallet().address;
  await db.query("INSERT INTO merchants(wallet) VALUES($1)", [merchant]);
  const chain = testChain();
  return {
    merchant,
    payer,
    chain,
    service: createInvoiceService(db, chain, config),
  };
}

test("invoice and transaction preparation are idempotent and retain the server amount", async () => {
  const { merchant, payer, chain, service } = await setup(),
    id = randomUUID(),
    requestId = randomUUID();
  const invoice = await service.create(merchant, "Order", "24.99", 24, id);
  assert.equal(
    (await service.create(merchant, "Order", "24.99", 24, id)).id,
    id,
  );
  await assert.rejects(
    service.create(merchant, "Order", "0.01", 24, id),
    /already used/,
  );
  const first = await service.prepare(invoice.id, payer, undefined, requestId),
    again = await service.prepare(invoice.id, payer, undefined, requestId);
  assert.deepEqual(first, again);
  assert.equal(chain.built.length, 1);
  assert.equal(chain.built[0].amountAtomic, "24990000");
  assert.equal((await db.query("SELECT * FROM invoices")).rows.length, 1);
});
test("duplicate and concurrent confirmations count revenue only once", async () => {
  const { merchant, payer, chain, service } = await setup();
  const invoice = await service.create(
    merchant,
    "Sale",
    "24.99",
    24,
    randomUUID(),
  );
  const prepared = await service.prepare(
    invoice.id,
    payer,
    undefined,
    randomUUID(),
  );
  const signature = "4".repeat(88);
  chain.receipts.set(signature, transaction(chain.built[0]));
  const results = await Promise.all([
    service.confirm(invoice.id, prepared.attemptId, signature),
    service.confirm(invoice.id, prepared.attemptId, signature),
  ]);
  assert.equal(results[0].invoice.status, "paid");
  assert.equal(results[1].invoice.status, "paid");
  assert.equal((await service.history(merchant, 20, 0)).length, 1);
  assert.equal(
    (await db.query("SELECT * FROM audit_events WHERE action='invoice.paid'"))
      .rows.length,
    1,
  );
});
test("underpayments and missing receipts leave the invoice open", async () => {
  const { merchant, payer, chain, service } = await setup();
  const invoice = await service.create(
    merchant,
    "Sale",
    "24.99",
    24,
    randomUUID(),
  );
  const prepared = await service.prepare(
    invoice.id,
    payer,
    undefined,
    randomUUID(),
  );
  const signature = "4".repeat(88);
  await assert.rejects(
    service.confirm(invoice.id, prepared.attemptId, signature),
    /awaiting final confirmation/,
  );
  chain.receipts.set(signature, transaction(chain.built[0], "1"));
  await assert.rejects(
    service.confirm(invoice.id, prepared.attemptId, signature),
    /full invoice amount/,
  );
  assert.equal((await service.get(invoice.id)).status, "open");
  assert.equal((await service.history(merchant, 20, 0)).length, 0);
});
test("background reconciliation recovers a payment without a browser callback", async () => {
  const { merchant, payer, chain, service } = await setup();
  const invoice = await service.create(
    merchant,
    "Recovered sale",
    "24.99",
    24,
    randomUUID(),
  );
  await service.prepare(invoice.id, payer, undefined, randomUUID());
  const signature = "6".repeat(88);
  chain.receipts.set(signature, transaction(chain.built[0]));
  chain.findReceipts = async () => [signature];
  assert.equal(await reconcilePaymentsOnce(db, chain, service), 1);
  assert.equal((await service.get(invoice.id)).status, "paid");
  assert.equal((await service.history(merchant, 20, 0)).length, 1);
});

test("reconciliation retains unresolved receipts across index gaps and provider outages", async () => {
  const { merchant, payer, chain, service } = await setup();
  const invoice = await service.create(
    merchant,
    "Delayed receipt",
    "1",
    24,
    randomUUID(),
  );
  const prepared = await service.prepare(
    invoice.id,
    payer,
    undefined,
    randomUUID(),
  );
  // The fixture's finalized height is already past the prepared blockhash expiry.
  assert.equal(await reconcilePaymentsOnce(db, chain, service), 0);
  assert.equal(
    (
      await db.query<{ status: string }>(
        "SELECT status FROM payment_attempts WHERE id=$1",
        [prepared.attemptId],
      )
    ).rows[0].status,
    "prepared",
  );
  chain.findReceipts = async () => {
    throw new Error("RPC unavailable");
  };
  assert.equal(await reconcilePaymentsOnce(db, chain, service), 0);
  assert.equal((await service.get(invoice.id)).status, "open");
  const signature = "7".repeat(88);
  chain.receipts.set(signature, transaction(chain.built[0]));
  chain.findReceipts = async () => [signature];
  assert.equal(await reconcilePaymentsOnce(db, chain, service), 1);
  assert.equal((await service.get(invoice.id)).status, "paid");
});
test("merchant history is isolated, case-sensitive, paginated and not capped at 50 records", async () => {
  const { merchant, service } = await setup();
  const other = signingWallet().address;
  await db.query("INSERT INTO merchants(wallet) VALUES($1)", [other]);
  for (let index = 0; index < 55; index++)
    await service.create(merchant, `Order ${index}`, "1", 24, randomUUID());
  await service.create(other, "Private invoice", "1", 24, randomUUID());
  assert.equal((await service.list(merchant, 100, 0)).length, 55);
  assert.equal((await service.list(merchant, 20, 40)).length, 15);
  assert.equal((await service.list(other, 100, 0))[0].title, "Private invoice");
  assert.equal((await service.list(merchant.toLowerCase(), 100, 0)).length, 0);
});
test("cancelled, expired and self-payment invoices cannot prepare a transfer", async () => {
  const { merchant, payer, service } = await setup();
  const invoice = await service.create(merchant, "Sale", "1", 24, randomUUID());
  await assert.rejects(
    service.prepare(invoice.id, merchant, undefined, randomUUID()),
    /different wallet/,
  );
  await assert.rejects(service.cancel(invoice.id, payer), /not found/);
  await db.query(
    "UPDATE invoices SET expires_at=now()-interval '1 second' WHERE id=$1",
    [invoice.id],
  );
  await assert.rejects(
    service.prepare(invoice.id, payer, undefined, randomUUID()),
    /expired/,
  );
  await service.cancel(invoice.id, merchant);
  await assert.rejects(
    service.prepare(invoice.id, payer, undefined, randomUUID()),
    /cancelled/,
  );
});
