import { randomUUID } from "node:crypto";
import {
  isCompromisedWallet,
  parseUsdc,
  type Invoice,
  type PreparedPayment,
} from "@sentinelpay/shared";
import type { Database, Sql } from "../lib/db";
import type { AppConfig } from "../lib/env";
import { HttpError } from "../lib/errors";
import type { Chain, ReceiptExpectation } from "./chain";
import {
  paymentSummary,
  receiptSelect,
  receiptView,
  type ReceiptRow,
} from "./receiptService";

type InvoiceRow = {
  id: string;
  merchant_wallet: string;
  name: string;
  title: string;
  amount_atomic: string;
  mint: string;
  cluster: Invoice["cluster"];
  status: Invoice["status"];
  paid_late: boolean;
  expires_at: Date;
  created_at: Date;
  signature?: string;
};
type Attempt = {
  id: string;
  invoice_id: string;
  payer: string;
  input_mint: string;
  unsigned_transaction: string;
  memo: string;
  blockhash: string;
  last_valid_block_height: string;
  status: string;
  signature: string | null;
  created_at: Date;
};
const selectInvoice =
  "SELECT i.*,m.name,p.signature FROM invoices i JOIN merchants m ON m.wallet=i.merchant_wallet LEFT JOIN payment_attempts p ON p.invoice_id=i.id AND p.status='confirmed'";
const toInvoice = (r: InvoiceRow): Invoice => ({
  id: r.id,
  merchantWallet: r.merchant_wallet,
  merchantName: r.name,
  title: r.title,
  amountAtomic: r.amount_atomic,
  mint: r.mint,
  cluster: r.cluster,
  status: r.status,
  paidLate: r.paid_late,
  expiresAt: new Date(r.expires_at).toISOString(),
  createdAt: new Date(r.created_at).toISOString(),
  ...(r.signature ? { signature: r.signature } : {}),
});
const preparedView = (r: Attempt): PreparedPayment => ({
  attemptId: r.id,
  transaction: r.unsigned_transaction,
  blockhash: r.blockhash,
  lastValidBlockHeight: Number(r.last_valid_block_height),
});

export function createInvoiceService(
  db: Database,
  chain: Chain,
  config: AppConfig,
  now = () => new Date(),
) {
  async function get(id: string, sql: Sql = db) {
    const r = (
      await sql.query<InvoiceRow>(selectInvoice + " WHERE i.id=$1", [id])
    ).rows[0];
    if (!r) throw new HttpError(404, "Invoice not found.");
    return toInvoice(r);
  }
  function network(invoice: Invoice) {
    if (invoice.cluster !== config.cluster || invoice.mint !== config.usdcMint)
      throw new HttpError(
        409,
        "Invoice belongs to a different payment network.",
      );
  }
  function open(invoice: Invoice) {
    network(invoice);
    if (isCompromisedWallet(invoice.merchantWallet))
      throw new HttpError(
        409,
        "This recipient wallet is retired. Contact the merchant for a replacement invoice.",
      );
    if (invoice.status !== "open")
      throw new HttpError(409, `Invoice is ${invoice.status}.`);
    if (new Date(invoice.expiresAt) <= now())
      throw new HttpError(410, "Invoice has expired.");
  }
  async function existingReceipt(
    signature: string,
    invoiceId: string,
    attemptId: string,
    sql: Sql = db,
  ) {
    const r = (
      await sql.query<{
        id: string;
        invoice_id: string;
        attempt_id: string;
        applied_atomic: string;
      }>(
        "SELECT id,invoice_id,attempt_id,applied_atomic FROM payment_receipts WHERE signature=$1",
        [signature],
      )
    ).rows[0];
    if (r && (r.invoice_id !== invoiceId || r.attempt_id !== attemptId))
      throw new HttpError(
        409,
        "This signature belongs to another payment request.",
      );
    return r;
  }
  return {
    get,
    async create(
      wallet: string,
      title: string,
      amount: string,
      hours: number,
      id: string,
    ) {
      if (isCompromisedWallet(wallet))
        throw new HttpError(403, "This signing wallet is retired.");
      const atomic = parseUsdc(amount).toString();
      return db.transaction(async (tx) => {
        const prior = (
          await tx.query<InvoiceRow>("SELECT * FROM invoices WHERE id=$1", [id])
        ).rows[0];
        if (prior) {
          if (
            prior.merchant_wallet !== wallet ||
            prior.title !== title ||
            prior.amount_atomic !== atomic ||
            new Date(prior.expires_at).getTime() -
              new Date(prior.created_at).getTime() !==
              hours * 60 * 60_000
          )
            throw new HttpError(409, "Invoice request ID was already used.");
          return get(id, tx);
        }
        const created = now(),
          expiry = new Date(created.getTime() + hours * 60 * 60_000);
        await tx.query(
          "INSERT INTO invoices(id,merchant_wallet,title,amount_atomic,mint,cluster,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            id,
            wallet,
            title,
            atomic,
            config.usdcMint,
            config.cluster,
            expiry,
            created,
          ],
        );
        await tx.query(
          "INSERT INTO audit_events(wallet,action,entity_id) VALUES($1,'invoice.created',$2)",
          [wallet, id],
        );
        return get(id, tx);
      });
    },
    async list(wallet: string, limit: number, offset: number) {
      return (
        await db.query<InvoiceRow>(
          selectInvoice +
            " WHERE i.merchant_wallet=$1 AND i.cluster=$2 ORDER BY i.created_at DESC,i.id LIMIT $3 OFFSET $4",
          [wallet, config.cluster, limit, offset],
        )
      ).rows.map(toInvoice);
    },
    async prepare(
      id: string,
      payer: string,
      inputMint: string | undefined,
      requestId: string,
    ): Promise<PreparedPayment> {
      const invoice = await get(id);
      open(invoice);
      if (isCompromisedWallet(payer))
        throw new HttpError(403, "This signing wallet is retired.");
      if (payer === invoice.merchantWallet)
        throw new HttpError(
          400,
          "Use a different wallet to pay your own invoice.",
        );
      const mint = inputMint || invoice.mint;
      function matches(r: Attempt) {
        if (r.invoice_id !== id || r.payer !== payer || r.input_mint !== mint)
          throw new HttpError(409, "Payment request ID was already used.");
        return preparedView(r);
      }
      const previous = (
        await db.query<Attempt>("SELECT * FROM payment_attempts WHERE id=$1", [
          requestId,
        ])
      ).rows[0];
      if (previous) return matches(previous);
      const memo = `sentinelpay:${id}:${requestId}`;
      const expected: ReceiptExpectation = {
        payer,
        merchant: invoice.merchantWallet,
        mint: invoice.mint,
        amountAtomic: invoice.amountAtomic,
        memo,
        createdAt: new Date(invoice.createdAt),
        expiresAt: new Date(invoice.expiresAt),
      };
      const built = await chain.buildPayment({ ...expected, inputMint });
      await db.transaction(async (tx) => {
        const r = (
          await tx.query<{ status: string }>(
            "SELECT status FROM invoices WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (r.status !== "open" || new Date(invoice.expiresAt) <= now())
          throw new HttpError(409, "Invoice is no longer payable.");
        await tx.query(
          "INSERT INTO payment_attempts(id,invoice_id,payer,input_mint,memo,blockhash,last_valid_block_height,unsigned_transaction) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING",
          [
            requestId,
            id,
            payer,
            mint,
            memo,
            built.blockhash,
            built.lastValidBlockHeight,
            built.transaction,
          ],
        );
      });
      return matches(
        (
          await db.query<Attempt>(
            "SELECT * FROM payment_attempts WHERE id=$1",
            [requestId],
          )
        ).rows[0],
      );
    },
    async confirm(id: string, attemptId: string, signature: string) {
      const invoice = await get(id);
      network(invoice);
      const attempt = (
        await db.query<Attempt>(
          "SELECT * FROM payment_attempts WHERE id=$1 AND invoice_id=$2",
          [attemptId, id],
        )
      ).rows[0];
      if (!attempt) throw new HttpError(404, "Payment attempt not found.");
      const prior = await existingReceipt(signature, id, attemptId);
      if (prior)
        return {
          invoice,
          pending: false,
          duplicate: prior.applied_atomic === "0",
          receiptId: prior.id,
          recorded: false,
        };
      let verified;
      try {
        verified = await chain.receipt(signature, {
          payer: attempt.payer,
          merchant: invoice.merchantWallet,
          mint: invoice.mint,
          amountAtomic: invoice.amountAtomic,
          memo: attempt.memo,
          blockhash: attempt.blockhash,
          createdAt: new Date(attempt.created_at),
          expiresAt: new Date(invoice.expiresAt),
        });
      } catch (error) {
        if (error instanceof HttpError && error.code === "TRANSACTION_FAILED")
          await db.query(
            "UPDATE payment_attempts SET status='failed' WHERE id=$1 AND status='prepared'",
            [attemptId],
          );
        if (
          error instanceof HttpError &&
          error.status === 202 &&
          Date.now() - new Date(attempt.created_at).getTime() < 15 * 60_000 &&
          (await chain.expiredUnlanded(
            signature,
            attempt.memo,
            Number(attempt.last_valid_block_height),
          ))
        ) {
          await db.query(
            "UPDATE payment_attempts SET status='failed' WHERE id=$1 AND status='prepared'",
            [attemptId],
          );
          throw new HttpError(
            410,
            "The signed transaction expired without landing. A replacement payment can be prepared.",
            "TRANSACTION_EXPIRED",
          );
        }
        throw error;
      }
      const recorded = await db.transaction(async (tx) => {
        const locked = (
          await tx.query<{ status: string }>(
            "SELECT status FROM invoices WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        const existing = await existingReceipt(signature, id, attemptId, tx);
        if (existing)
          return {
            receiptId: existing.id,
            duplicate: existing.applied_atomic === "0",
            recorded: false,
          };
        const applied = locked.status === "open" ? invoice.amountAtomic : "0",
          receiptId = randomUUID();
        await tx.query(
          "INSERT INTO payment_receipts(id,signature,attempt_id,invoice_id,received_atomic,applied_atomic,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            receiptId,
            signature,
            attemptId,
            id,
            verified.receivedAtomic,
            applied,
            verified.confirmedAt,
          ],
        );
        await tx.query(
          "UPDATE payment_attempts SET signature=COALESCE(signature,$1),status=CASE WHEN status='confirmed' THEN 'confirmed' ELSE $2 END,received_atomic=COALESCE(received_atomic,$3),confirmed_at=COALESCE(confirmed_at,$4) WHERE id=$5",
          [
            signature,
            applied === "0" ? "duplicate" : "confirmed",
            verified.receivedAtomic,
            verified.confirmedAt,
            attemptId,
          ],
        );
        if (applied !== "0") {
          await tx.query(
            "UPDATE invoices SET status='paid',paid_late=$2 WHERE id=$1",
            [id, verified.paidLate],
          );
          await tx.query(
            "INSERT INTO audit_events(wallet,action,entity_id) VALUES($1,'invoice.paid',$2)",
            [invoice.merchantWallet, id],
          );
        } else
          await tx.query(
            "INSERT INTO audit_events(wallet,action,entity_id) VALUES($1,'payment.duplicate',$2)",
            [invoice.merchantWallet, receiptId],
          );
        return { receiptId, duplicate: applied === "0", recorded: true };
      });
      return { invoice: await get(id), pending: false, ...recorded };
    },
    async cancel(id: string, wallet: string) {
      await db.transaction(async (tx) => {
        const own = (
          await tx.query<{ status: string }>(
            "SELECT status FROM invoices WHERE id=$1 AND merchant_wallet=$2 FOR UPDATE",
            [id, wallet],
          )
        ).rows[0];
        if (!own || own.status !== "open")
          throw new HttpError(409, "Open invoice not found for this merchant.");
        if (
          (
            await tx.query(
              "SELECT id FROM payment_attempts WHERE invoice_id=$1 LIMIT 1",
              [id],
            )
          ).rows.length
        )
          throw new HttpError(
            409,
            "A payment attempt exists. Reconcile it before cancelling this invoice.",
          );
        await tx.query("UPDATE invoices SET status='cancelled' WHERE id=$1", [
          id,
        ]);
      });
      return get(id);
    },
    async history(wallet: string, limit: number, offset: number) {
      return (
        await db.query<ReceiptRow>(
          receiptSelect +
            " WHERE i.merchant_wallet=$1 AND i.cluster=$2 ORDER BY r.confirmed_at DESC,r.id LIMIT $3 OFFSET $4",
          [wallet, config.cluster, limit, offset],
        )
      ).rows.map(receiptView);
    },
    async summary(wallet: string) {
      return paymentSummary(db, wallet, config.cluster);
    },
  };
}
