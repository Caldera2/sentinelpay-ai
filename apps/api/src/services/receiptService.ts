import type { Cluster, Invoice, PaymentRecord } from "@sentinelpay/shared";
import type { Sql } from "../lib/db";
export type ReceiptRow = {
  id: string;
  signature: string;
  attempt_id: string;
  invoice_id: string;
  invoice_status: Invoice["status"];
  merchant_wallet: string;
  title: string;
  payer: string;
  amount_atomic: string;
  received_atomic: string;
  applied_atomic: string;
  refunded_atomic: string;
  cluster: Cluster;
  confirmed_at: Date;
};
export const receiptSelect = `SELECT r.*,i.title,i.amount_atomic,i.cluster,i.merchant_wallet,i.status AS invoice_status,p.payer,
  COALESCE((SELECT sum(f.amount_atomic) FROM refunds f WHERE f.receipt_id=r.id AND f.status='confirmed'),0)::text AS refunded_atomic
  FROM payment_receipts r JOIN invoices i ON i.id=r.invoice_id JOIN payment_attempts p ON p.id=r.attempt_id`;
export const receiptView = (r: ReceiptRow): PaymentRecord => ({
  id: r.id,
  invoiceId: r.invoice_id,
  title: r.title,
  payer: r.payer,
  amountAtomic: r.amount_atomic,
  receivedAtomic: r.received_atomic,
  appliedAtomic: r.applied_atomic,
  refundedAtomic: r.refunded_atomic,
  refundableAtomic: (
    BigInt(r.received_atomic) - BigInt(r.refunded_atomic)
  ).toString(),
  kind:
    BigInt(r.applied_atomic) > 0n
      ? "payment"
      : r.invoice_status === "cancelled"
        ? "cancelled"
        : "duplicate",
  signature: r.signature,
  cluster: r.cluster,
  confirmedAt: new Date(r.confirmed_at).toISOString(),
});
export async function paymentSummary(
  sql: Sql,
  wallet: string,
  cluster: Cluster,
) {
  const result = await sql.query<{
    gross: string;
    refunded: string;
    excess: string;
    received: string;
    count: string;
  }>(
    `SELECT
    COALESCE(sum(applied_atomic),0)::text AS gross,
    COALESCE(sum(LEAST(applied_atomic,GREATEST(0::numeric,refunded_atomic::numeric-(received_atomic-applied_atomic)))),0)::text AS refunded,
    COALESCE(sum(GREATEST(0::numeric,received_atomic-applied_atomic-refunded_atomic::numeric)),0)::text AS excess,
    COALESCE(sum(received_atomic),0)::text AS received,count(*) FILTER(WHERE applied_atomic>0)::text AS count
    FROM (${receiptSelect} WHERE i.merchant_wallet=$1 AND i.cluster=$2) receipts`,
    [wallet, cluster],
  );
  const r = result.rows[0];
  return {
    revenueAtomic: (BigInt(r.gross) - BigInt(r.refunded)).toString(),
    grossRevenueAtomic: r.gross,
    refundedInvoiceAtomic: r.refunded,
    outstandingExcessAtomic: r.excess,
    receivedAtomic: r.received,
    paymentCount: Number(r.count),
  };
}
