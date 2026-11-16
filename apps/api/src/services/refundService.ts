import {
  isCompromisedWallet,
  parseUsdc,
  type PreparedRefund,
} from "@sentinelpay/shared";
import type { Database, Sql } from "../lib/db";
import type { AppConfig } from "../lib/env";
import { HttpError } from "../lib/errors";
import { paymentReference, type Chain } from "./chain";
import { receiptSelect, type ReceiptRow } from "./receiptService";

type RefundRow = {
  id: string;
  receipt_id: string;
  merchant_wallet: string;
  destination: string;
  amount_atomic: string;
  reason: string;
  memo: string;
  blockhash: string;
  last_valid_block_height: string;
  unsigned_transaction: string;
  submitted_signature: string | null;
  signature: string | null;
  status: PreparedRefund["status"];
  created_at: Date;
  cluster: PreparedRefund["cluster"];
  mint: string;
};
const selectRefund =
  "SELECT f.*,i.cluster,i.mint FROM refunds f JOIN payment_receipts r ON r.id=f.receipt_id JOIN invoices i ON i.id=r.invoice_id";
const view = (r: RefundRow): PreparedRefund => ({
  id: r.id,
  attemptId: r.id,
  receiptId: r.receipt_id,
  destination: r.destination,
  amountAtomic: r.amount_atomic,
  reason: r.reason,
  status: r.status,
  submittedSignature: r.submitted_signature,
  signature: r.signature,
  transaction: r.unsigned_transaction,
  blockhash: r.blockhash,
  lastValidBlockHeight: Number(r.last_valid_block_height),
  cluster: r.cluster,
});
export function createRefundService(
  db: Database,
  chain: Chain,
  config: AppConfig,
) {
  async function get(wallet: string, id: string, sql: Sql = db) {
    const r = (
      await sql.query<RefundRow>(
        `${selectRefund} WHERE f.id=$1 AND f.merchant_wallet=$2`,
        [id, wallet],
      )
    ).rows[0];
    if (!r) throw new HttpError(404, "Refund not found for this merchant.");
    return r;
  }
  async function receipt(wallet: string, id: string, sql: Sql = db) {
    const r = (
      await sql.query<ReceiptRow>(
        `${receiptSelect} WHERE r.id=$1 AND i.merchant_wallet=$2 AND i.cluster=$3`,
        [id, wallet, config.cluster],
      )
    ).rows[0];
    if (!r)
      throw new HttpError(
        404,
        "Verified payment receipt not found for this merchant.",
      );
    return r;
  }
  async function confirm(wallet: string, id: string, signature: string) {
    const refund = await get(wallet, id);
    if (refund.cluster !== config.cluster || refund.mint !== config.usdcMint)
      throw new HttpError(
        409,
        "Refund belongs to a different payment network.",
      );
    if (refund.status === "confirmed") {
      if (refund.signature !== signature)
        throw new HttpError(
          409,
          "A different refund receipt is already recorded.",
        );
      return { pending: false, refund: view(refund) };
    }
    await db.query(
      "UPDATE refunds SET submitted_signature=$1 WHERE id=$2 AND merchant_wallet=$3 AND status!='confirmed'",
      [signature, id, wallet],
    );
    let verified;
    try {
      verified = await chain.receipt(signature, {
        payer: wallet,
        merchant: refund.destination,
        mint: refund.mint,
        amountAtomic: refund.amount_atomic,
        memo: refund.memo,
        blockhash: refund.blockhash,
        createdAt: new Date(refund.created_at),
        expiresAt: new Date(
          new Date(refund.created_at).getTime() + 15 * 60_000,
        ),
      });
    } catch (error) {
      if (error instanceof HttpError && error.code === "TRANSACTION_FAILED")
        await db.query(
          "UPDATE refunds SET status='failed' WHERE id=$1 AND status='prepared'",
          [id],
        );
      throw error;
    }
    if (verified.receivedAtomic !== refund.amount_atomic)
      throw new HttpError(
        422,
        "Refund credit does not match the approved amount.",
      );
    await db.transaction(async (tx) => {
      // All refund budget mutations lock the receipt first, then the refund.
      await tx.query("SELECT id FROM payment_receipts WHERE id=$1 FOR UPDATE", [
        refund.receipt_id,
      ]);
      const locked = (
        await tx.query<{ status: string; signature: string | null }>(
          "SELECT status,signature FROM refunds WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (locked.status === "confirmed") {
        if (locked.signature !== signature)
          throw new HttpError(409, "A different refund is already recorded.");
        return;
      }
      const budget = await receipt(wallet, refund.receipt_id, tx);
      if (
        BigInt(budget.refunded_atomic) + BigInt(refund.amount_atomic) >
        BigInt(budget.received_atomic)
      )
        throw new HttpError(
          409,
          "Refund budget is exhausted. Review the on-chain transaction before sending more funds.",
        );
      await tx.query(
        "UPDATE refunds SET status='confirmed',signature=$1,confirmed_at=$2 WHERE id=$3",
        [signature, verified.confirmedAt, id],
      );
      await tx.query(
        "INSERT INTO audit_events(wallet,action,entity_id) VALUES($1,'refund.confirmed',$2)",
        [wallet, id],
      );
    });
    return { pending: false, refund: view(await get(wallet, id)) };
  }
  return {
    confirm,
    async pending(wallet: string) {
      const r = (
        await db.query<RefundRow>(
          `${selectRefund} WHERE f.merchant_wallet=$1 AND f.status='prepared' ORDER BY f.created_at`,
          [wallet],
        )
      ).rows[0];
      return r ? view(r) : null;
    },
    async history(wallet: string, limit: number, offset: number) {
      return (
        await db.query<RefundRow>(
          `${selectRefund} WHERE f.merchant_wallet=$1 AND i.cluster=$2 ORDER BY f.created_at DESC,f.id LIMIT $3 OFFSET $4`,
          [wallet, config.cluster, limit, offset],
        )
      ).rows.map(view);
    },
    async prepare(
      wallet: string,
      receiptId: string,
      amountUsdc: string,
      reason: string,
      id: string,
    ) {
      const amount = parseUsdc(amountUsdc).toString();
      const prior = (
        await db.query<RefundRow>(`${selectRefund} WHERE f.id=$1`, [id])
      ).rows[0];
      if (prior) {
        if (
          prior.merchant_wallet !== wallet ||
          prior.receipt_id !== receiptId ||
          prior.amount_atomic !== amount ||
          prior.reason !== reason ||
          prior.status !== "prepared"
        )
          throw new HttpError(409, "Refund request ID was already used.");
        return view(prior);
      }
      const source = await receipt(wallet, receiptId);
      if (isCompromisedWallet(wallet) || isCompromisedWallet(source.payer))
        throw new HttpError(
          409,
          "An exposed wallet requires manual recovery review; this refund cannot be prepared.",
        );
      if (
        BigInt(amount) >
        BigInt(source.received_atomic) - BigInt(source.refunded_atomic)
      )
        throw new HttpError(
          422,
          "Refund exceeds the unrefunded amount received.",
        );
      if (BigInt(await chain.balance(wallet, config.usdcMint)) < BigInt(amount))
        throw new HttpError(
          422,
          "Wallet USDC balance is insufficient for this refund.",
        );
      const memo = `sentinelpay:refund:${receiptId}:${id}`,
        createdAt = new Date();
      const built = await chain.buildPayment({
        payer: wallet,
        merchant: source.payer,
        mint: config.usdcMint,
        amountAtomic: amount,
        memo,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 15 * 60_000),
      });
      await db.transaction(async (tx) => {
        await tx.query(
          "SELECT id FROM payment_receipts WHERE id=$1 FOR UPDATE",
          [receiptId],
        );
        const current = await receipt(wallet, receiptId, tx);
        if (
          BigInt(amount) >
          BigInt(current.received_atomic) - BigInt(current.refunded_atomic)
        )
          throw new HttpError(
            409,
            "Refund budget changed. Refresh the receipt.",
          );
        const existing = (
          await tx.query<{
            id: string;
            receipt_id: string;
            amount_atomic: string;
            reason: string;
          }>(
            "SELECT id,receipt_id,amount_atomic,reason FROM refunds WHERE merchant_wallet=$1 AND status='prepared'",
            [wallet],
          )
        ).rows[0];
        if (existing) {
          if (
            existing.id === id &&
            existing.receipt_id === receiptId &&
            existing.amount_atomic === amount &&
            existing.reason === reason
          )
            return;
          throw new HttpError(
            409,
            "Resolve the pending refund before preparing another.",
          );
        }
        await tx.query(
          "INSERT INTO refunds(id,receipt_id,merchant_wallet,destination,amount_atomic,reason,memo,blockhash,last_valid_block_height,unsigned_transaction,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            id,
            receiptId,
            wallet,
            source.payer,
            amount,
            reason,
            memo,
            built.blockhash,
            built.lastValidBlockHeight,
            built.transaction,
            createdAt,
          ],
        );
        await tx.query(
          "INSERT INTO audit_events(wallet,action,entity_id) VALUES($1,'refund.prepared',$2)",
          [wallet, id],
        );
      });
      return view(await get(wallet, id));
    },
    async expire(wallet: string, id: string) {
      const refund = await get(wallet, id);
      if (refund.cluster !== config.cluster || refund.mint !== config.usdcMint)
        throw new HttpError(
          409,
          "Refund belongs to a different payment network.",
        );
      if (refund.status !== "prepared")
        throw new HttpError(409, "This refund is no longer pending.");
      const candidates = [
        ...new Set([
          ...(refund.submitted_signature ? [refund.submitted_signature] : []),
          ...(await chain.findReceipts(
            paymentReference(refund.memo).toBase58(),
          )),
        ]),
      ];
      for (const signature of candidates) {
        try {
          await confirm(wallet, id, signature);
          return { expired: false, confirmed: true };
        } catch (error) {
          if (
            !(error instanceof HttpError) ||
            ![202, 422].includes(error.status)
          )
            throw error;
        }
      }
      if (Date.now() - new Date(refund.created_at).getTime() > 15 * 60_000)
        throw new HttpError(
          409,
          "This older refund needs receipt reconciliation before replacement.",
        );
      const unlanded = refund.submitted_signature
        ? await chain.expiredUnlanded(
            refund.submitted_signature,
            refund.memo,
            Number(refund.last_valid_block_height),
          )
        : candidates.length === 0 &&
          (await chain.blockHeight()) > Number(refund.last_valid_block_height);
      if (!unlanded)
        throw new HttpError(
          409,
          "Refund settlement is uncertain or its transaction is still valid. Check its receipt before retrying.",
        );
      await db.query(
        "UPDATE refunds SET status='expired' WHERE id=$1 AND status='prepared'",
        [id],
      );
      return { expired: true, confirmed: false };
    },
  };
}
