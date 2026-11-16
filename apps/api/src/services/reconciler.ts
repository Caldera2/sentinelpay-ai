import type { Database } from "../lib/db";
import { HttpError } from "../lib/errors";
import { paymentReference, type Chain } from "./chain";
import type { createInvoiceService } from "./invoiceService";
import type { createRefundService } from "./refundService";

/** Recover payments even when a wallet callback or customer browser disappears after submission. */
export async function reconcilePaymentsOnce(
  db: Database,
  chain: Chain,
  invoices: ReturnType<typeof createInvoiceService>,
) {
  const attempts = await db.query<{
    id: string;
    invoice_id: string;
    memo: string;
  }>(
    "SELECT id,invoice_id,memo FROM payment_attempts WHERE status='prepared' OR (status IN ('confirmed','duplicate') AND created_at>now()-interval '24 hours' AND (last_checked_at IS NULL OR last_checked_at<now()-interval '1 minute')) ORDER BY COALESCE(last_checked_at,created_at),id LIMIT 25",
  );
  let verified = 0;
  for (const attempt of attempts.rows) {
    try {
      const signatures = await chain.findReceipts(
        paymentReference(attempt.memo).toBase58(),
      );
      for (const signature of signatures) {
        try {
          const result = await invoices.confirm(
            attempt.invoice_id,
            attempt.id,
            signature,
          );
          if (result.recorded) verified++;
        } catch (error) {
          if (
            !(error instanceof HttpError) ||
            ![202, 409, 422].includes(error.status)
          )
            throw error;
        }
      }
      // An empty address index can be incomplete or temporarily behind. Without
      // a known signature, blockhash expiry alone does not prove non-settlement.
      // Keep this attempt available for subsequent receipt recovery.
    } catch {
      // Provider outages must not turn unknown transactions into failed/successful receipts.
      console.warn(
        "Payment reconciliation deferred for an unavailable receipt.",
      );
    } finally {
      await db.query(
        "UPDATE payment_attempts SET last_checked_at=now() WHERE id=$1",
        [attempt.id],
      );
    }
  }
  return verified;
}

export async function reconcileRefundsOnce(
  db: Database,
  chain: Chain,
  refunds: ReturnType<typeof createRefundService>,
) {
  const pending = await db.query<{
    id: string;
    merchant_wallet: string;
    memo: string;
    submitted_signature: string | null;
  }>(
    "SELECT id,merchant_wallet,memo,submitted_signature FROM refunds WHERE status='prepared' ORDER BY COALESCE(last_checked_at,created_at),id LIMIT 25",
  );
  let verified = 0;
  for (const item of pending.rows) {
    try {
      const candidates = [
        ...new Set([
          ...(item.submitted_signature ? [item.submitted_signature] : []),
          ...(await chain.findReceipts(paymentReference(item.memo).toBase58())),
        ]),
      ];
      for (const signature of candidates) {
        try {
          await refunds.confirm(item.merchant_wallet, item.id, signature);
          verified++;
          break;
        } catch (error) {
          if (
            !(error instanceof HttpError) ||
            ![202, 422].includes(error.status)
          )
            throw error;
        }
      }
    } catch {
      console.warn("Refund reconciliation will retry an unavailable receipt.");
    } finally {
      await db.query("UPDATE refunds SET last_checked_at=now() WHERE id=$1", [
        item.id,
      ]);
    }
  }
  return verified;
}

export function startReconciler(
  db: Database,
  chain: Chain,
  invoices: ReturnType<typeof createInvoiceService>,
  refunds?: ReturnType<typeof createRefundService>,
) {
  let running: Promise<unknown> | null = null;
  const timer = setInterval(() => {
    if (!running)
      running = reconcilePaymentsOnce(db, chain, invoices)
        .then(() =>
          refunds ? reconcileRefundsOnce(db, chain, refunds) : undefined,
        )
        .catch(() => console.warn("Payment reconciliation will retry."))
        .finally(() => {
          running = null;
        });
  }, 20_000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await running;
  };
}
