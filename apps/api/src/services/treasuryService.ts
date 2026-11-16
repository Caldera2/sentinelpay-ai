import {
  suggestPaymentStrategy,
  type PreparedTrade,
} from "@sentinelpay/shared";
import type { Database } from "../lib/db";
import type { AppConfig } from "../lib/env";
import { HttpError } from "../lib/errors";
import type { Chain } from "./chain";

type Trade = {
  id: string;
  merchant_wallet: string;
  direction: "allocate" | "withdraw";
  input_mint: string;
  output_mint: string;
  input_atomic: string;
  minimum_output_atomic: string;
  memo: string;
  blockhash: string;
  last_valid_block_height: string;
  unsigned_transaction: string;
  submitted_signature: string | null;
  signature: string | null;
  status: string;
  created_at: Date;
};
const view = (trade: Trade): PreparedTrade => ({
  id: trade.id,
  direction: trade.direction,
  transaction: trade.unsigned_transaction,
  blockhash: trade.blockhash,
  lastValidBlockHeight: Number(trade.last_valid_block_height),
  submittedSignature: trade.submitted_signature,
});
export function createTreasuryService(
  db: Database,
  chain: Chain,
  config: AppConfig,
) {
  const enabled = () => {
    if (!config.treasuryEnabled || !config.rwaMint)
      throw new HttpError(
        503,
        "Yield trading is not configured. Your USDC stays in your wallet.",
      );
  };
  async function get(wallet: string, id: string) {
    const row = (
      await db.query<Trade>(
        "SELECT * FROM treasury_trades WHERE id=$1 AND merchant_wallet=$2",
        [id, wallet],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Treasury request not found.");
    return row;
  }
  return {
    async pending(wallet: string) {
      const row = (
        await db.query<Trade>(
          "SELECT * FROM treasury_trades WHERE merchant_wallet=$1 AND status='prepared'",
          [wallet],
        )
      ).rows[0];
      return row ? view(row) : null;
    },
    async prepare(
      wallet: string,
      direction: "allocate" | "withdraw",
      id: string,
      requested?: string,
    ) {
      enabled();
      const existing = (
        await db.query<Trade>("SELECT * FROM treasury_trades WHERE id=$1", [id])
      ).rows[0];
      if (existing) {
        if (
          existing.merchant_wallet !== wallet ||
          existing.direction !== direction ||
          existing.status !== "prepared"
        )
          throw new HttpError(409, "Treasury request ID was already used.");
        return view(existing);
      }
      const merchant = (
        await db.query<{
          reserve_atomic: string;
          expenses_atomic: string;
          liquid_bps: number;
          eligibility_acknowledged: boolean;
        }>("SELECT * FROM merchants WHERE wallet=$1", [wallet])
      ).rows[0];
      if (!merchant.eligibility_acknowledged)
        throw new HttpError(
          403,
          "Review and acknowledge provider eligibility before using treasury trading.",
        );
      const inputMint =
        direction === "allocate" ? config.usdcMint : config.rwaMint!;
      const outputMint =
        direction === "allocate" ? config.rwaMint! : config.usdcMint;
      const balance = await chain.balance(wallet, inputMint);
      const suggested =
        direction === "allocate"
          ? suggestPaymentStrategy({
              availableUsdcAtomic: balance,
              reserveAtomic: merchant.reserve_atomic,
              upcomingExpensesAtomic: merchant.expenses_atomic,
              liquidBps: merchant.liquid_bps,
            }).suggestedAllocationAtomic
          : balance;
      const amount = requested || suggested;
      if (BigInt(amount) <= 0n || BigInt(amount) > BigInt(suggested))
        throw new HttpError(
          422,
          "This trade exceeds the available balance or cash reserve policy.",
        );
      const memo = `sentinelpay:treasury:${id}`;
      const built = await chain.buildTreasury(
        wallet,
        inputMint,
        outputMint,
        amount,
        memo,
      );
      await db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO treasury_trades(id,merchant_wallet,direction,input_mint,output_mint,input_atomic,minimum_output_atomic,memo,blockhash,last_valid_block_height,unsigned_transaction) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            id,
            wallet,
            direction,
            inputMint,
            outputMint,
            amount,
            built.minimumOutputAtomic,
            memo,
            built.blockhash,
            built.lastValidBlockHeight,
            built.transaction,
          ],
        );
        await tx.query(
          "INSERT INTO audit_events(wallet,action,entity_id) VALUES($1,$2,$3)",
          [wallet, `treasury.${direction}.prepared`, id],
        );
      });
      return view(await get(wallet, id));
    },
    async confirm(wallet: string, id: string, signature: string) {
      const trade = await get(wallet, id);
      if (trade.status === "confirmed") {
        if (trade.signature !== signature)
          throw new HttpError(
            409,
            "A different treasury receipt is already recorded.",
          );
        return { pending: false };
      }
      await db.query(
        "UPDATE treasury_trades SET submitted_signature=$1 WHERE id=$2 AND merchant_wallet=$3 AND status!='confirmed'",
        [signature, id, wallet],
      );
      const receipt = await chain.tradeReceipt(signature, {
        wallet,
        inputMint: trade.input_mint,
        outputMint: trade.output_mint,
        amountAtomic: trade.input_atomic,
        minimumOutputAtomic: trade.minimum_output_atomic,
        memo: trade.memo,
        blockhash: trade.blockhash,
        createdAt: new Date(trade.created_at),
      });
      await db.transaction(async (tx) => {
        const updated = await tx.query(
          "UPDATE treasury_trades SET status='confirmed',signature=$1,received_atomic=$2,confirmed_at=$3 WHERE id=$4 AND merchant_wallet=$5 AND status!='confirmed' RETURNING id",
          [signature, receipt.receivedAtomic, receipt.confirmedAt, id, wallet],
        );
        if (updated.rows.length)
          await tx.query(
            "INSERT INTO audit_events(wallet,action,entity_id) VALUES($1,'treasury.confirmed',$2)",
            [wallet, id],
          );
      });
      return { pending: false };
    },
    async expire(wallet: string, id: string) {
      const trade = await get(wallet, id);
      if (trade.status !== "prepared")
        throw new HttpError(409, "This treasury request is no longer pending.");
      if ((await chain.blockHeight()) <= Number(trade.last_valid_block_height))
        throw new HttpError(
          409,
          "The prepared transaction is still valid. Wait for expiry before replacing it.",
        );
      await db.query(
        "UPDATE treasury_trades SET status='expired' WHERE id=$1 AND merchant_wallet=$2 AND status='prepared'",
        [id, wallet],
      );
      return { ok: true };
    },
  };
}
