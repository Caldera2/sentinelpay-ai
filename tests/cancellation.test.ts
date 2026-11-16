import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Database } from "../apps/api/src/lib/db";
import { HttpError } from "../apps/api/src/lib/errors";
import { createInvoiceService } from "../apps/api/src/services/invoiceService";
import { createRefundService } from "../apps/api/src/services/refundService";
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
  const chain = testChain(),
    service = createInvoiceService(db, chain, config);
  const invoice = await service.create(
    merchant,
    "Cancellable order",
    "10",
    24,
    randomUUID(),
  );
  const requestId = randomUUID();
  const attempt = await service.prepare(
    invoice.id,
    payer,
    undefined,
    requestId,
  );
  return { merchant, payer, chain, service, invoice, attempt, requestId };
}

test("a failed on-chain payment attempt does not prevent invoice cancellation", async () => {
  const { merchant, chain, service, invoice, attempt } = await setup();
  const signature = "2".repeat(88),
    failed = transaction(chain.built[0]);
  failed.meta!.err = { InstructionError: [0, { Custom: 1 }] } as never;
  chain.receipts.set(signature, failed);
  await assert.rejects(
    service.confirm(invoice.id, attempt.attemptId, signature),
    (error) =>
      error instanceof HttpError && error.code === "TRANSACTION_FAILED",
  );
  assert.equal(
    (
      await db.query<{ status: string }>(
        "SELECT status FROM payment_attempts WHERE id=$1",
        [attempt.attemptId],
      )
    ).rows[0].status,
    "failed",
  );
  assert.equal(
    (await service.cancel(invoice.id, merchant)).status,
    "cancelled",
  );
  assert.equal((await service.summary(merchant)).revenueAtomic, "0");
});

test("rejected-wallet and unresolved attempts do not permanently lock cancellation", async () => {
  const { merchant, payer, chain, service, invoice, attempt, requestId } =
    await setup();
  await assert.rejects(
    service.confirm(invoice.id, attempt.attemptId, "3".repeat(88)),
    /awaiting final confirmation/,
  );
  // A second prepared attempt can represent a rejected wallet prompt with no broadcast.
  const secondRequestId = randomUUID();
  await service.prepare(invoice.id, payer, undefined, secondRequestId);
  chain.findReceipts = async () => {
    throw Error("Provider unavailable");
  };
  assert.equal(
    (await service.cancel(invoice.id, merchant)).status,
    "cancelled",
  );
  for (const id of [requestId, secondRequestId, randomUUID()])
    await assert.rejects(
      service.prepare(invoice.id, payer, undefined, id),
      /cancelled/,
    );
  // Preserve attempts so a transaction already signed can still be reconciled.
  assert.equal(
    (
      await db.query(
        "SELECT id FROM payment_attempts WHERE invoice_id=$1 AND status='prepared'",
        [invoice.id],
      )
    ).rows.length,
    2,
  );
});

test("an expired unlanded attempt also allows invoice cancellation", async () => {
  const { merchant, chain, service, invoice, attempt } = await setup();
  chain.expiredUnlanded = async () => true;
  await assert.rejects(
    service.confirm(invoice.id, attempt.attemptId, "4".repeat(88)),
    (error) =>
      error instanceof HttpError && error.code === "TRANSACTION_EXPIRED",
  );
  assert.equal(
    (await service.cancel(invoice.id, merchant)).status,
    "cancelled",
  );
});

test("only the owning merchant can cancel and repeated requests have one audit event", async () => {
  const { merchant, service, invoice } = await setup();
  await assert.rejects(
    service.cancel(invoice.id, signingWallet().address),
    (error) => error instanceof HttpError && error.status === 404,
  );
  const results = await Promise.all([
    service.cancel(invoice.id, merchant),
    service.cancel(invoice.id, merchant),
  ]);
  assert.ok(results.every((result) => result.status === "cancelled"));
  assert.equal(
    (
      await db.query(
        "SELECT id FROM audit_events WHERE action='invoice.cancelled' AND entity_id=$1",
        [invoice.id],
      )
    ).rows.length,
    1,
  );
});

test("paid invoices must be refunded and cannot be cancelled", async () => {
  const { merchant, chain, service, invoice, attempt } = await setup();
  const signature = "5".repeat(88);
  chain.receipts.set(signature, transaction(chain.built[0]));
  await service.confirm(invoice.id, attempt.attemptId, signature);
  await assert.rejects(
    service.cancel(invoice.id, merchant),
    (error) =>
      error instanceof HttpError &&
      error.status === 409 &&
      /refund/i.test(error.message),
  );
  assert.equal((await service.get(invoice.id)).status, "paid");
  assert.equal((await service.summary(merchant)).revenueAtomic, "10000000");
});

test("a payment already being confirmed after cancellation is recorded as refundable excess", async () => {
  const { merchant, payer, chain, service, invoice, attempt } = await setup();
  const signature = "6".repeat(88);
  chain.receipts.set(signature, transaction(chain.built[0]));
  let receiptRequested!: () => void, release!: () => void;
  const requested = new Promise<void>((resolve) => {
    receiptRequested = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const readReceipt = chain.receipt;
  chain.receipt = async (...args) => {
    receiptRequested();
    await waiting;
    return readReceipt(...args);
  };
  const confirmation = service.confirm(
    invoice.id,
    attempt.attemptId,
    signature,
  );
  await requested;
  try {
    await service.cancel(invoice.id, merchant);
  } finally {
    release();
  }
  const confirmed = await confirmation;
  assert.equal(confirmed.invoice.status, "cancelled");
  assert.equal(confirmed.duplicate, true);
  const [record] = await service.history(merchant, 20, 0);
  assert.equal(record.kind, "cancelled");
  assert.equal(record.receivedAtomic, "10000000");
  assert.equal(record.appliedAtomic, "0");
  assert.equal(record.refundableAtomic, "10000000");
  assert.equal(
    (await service.summary(merchant)).outstandingExcessAtomic,
    "10000000",
  );

  const refunds = createRefundService(db, chain, config);
  const refund = await refunds.prepare(
    merchant,
    record.id,
    "10",
    "Cancelled invoice",
    randomUUID(),
  );
  assert.equal(refund.destination, payer);
  const refundSignature = "7".repeat(88);
  chain.receipts.set(refundSignature, transaction(chain.built[1]));
  await refunds.confirm(merchant, refund.id, refundSignature);
  const summary = await service.summary(merchant);
  assert.equal(summary.revenueAtomic, "0");
  assert.equal(summary.paymentCount, 0);
  assert.equal(summary.refundedInvoiceAtomic, "0");
  assert.equal(summary.outstandingExcessAtomic, "0");
});

test("background reconciliation keeps recovering transfers for cancelled invoices", async () => {
  const { merchant, chain, service, invoice, attempt } = await setup();
  await service.cancel(invoice.id, merchant);
  const signature = "8".repeat(88);
  chain.receipts.set(signature, transaction(chain.built[0]));
  chain.findReceipts = async () => [signature];
  assert.equal(await reconcilePaymentsOnce(db, chain, service), 1);
  assert.equal((await service.get(invoice.id)).status, "cancelled");
  assert.equal((await service.history(merchant, 20, 0))[0].kind, "cancelled");
  assert.equal((await service.summary(merchant)).revenueAtomic, "0");
  assert.equal(
    (await service.confirm(invoice.id, attempt.attemptId, signature)).recorded,
    false,
  );
});

test("cancellation during transaction preparation cannot return a payable transaction", async () => {
  const { merchant, payer, chain, service } = await setup();
  const invoice = await service.create(
    merchant,
    "Preparation race",
    "1",
    24,
    randomUUID(),
  );
  let buildRequested!: () => void, release!: () => void;
  const requested = new Promise<void>((resolve) => {
    buildRequested = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const build = chain.buildPayment;
  chain.buildPayment = async (expected) => {
    buildRequested();
    await waiting;
    return build(expected);
  };
  const preparation = service.prepare(
    invoice.id,
    payer,
    undefined,
    randomUUID(),
  );
  const rejected = assert.rejects(preparation, /no longer payable/);
  await requested;
  try {
    await service.cancel(invoice.id, merchant);
  } finally {
    release();
  }
  await rejected;
  assert.equal(
    (
      await db.query("SELECT id FROM payment_attempts WHERE invoice_id=$1", [
        invoice.id,
      ])
    ).rows.length,
    0,
  );
});
