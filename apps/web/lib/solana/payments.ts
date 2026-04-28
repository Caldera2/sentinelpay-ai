import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import { Commitment, PublicKey, Transaction } from "@solana/web3.js";

type BuildUsdcTransferTransactionArgs = {
  connection: {
    getAccountInfo: (publicKey: PublicKey, commitment?: Commitment) => Promise<unknown>;
    getLatestBlockhash: (commitment?: Commitment) => Promise<{ blockhash: string }>;
  };
  payer: PublicKey;
  merchant: PublicKey;
  amountUsdc: number;
  usdcMint: PublicKey;
  decimals?: number;
};

function toAtomicAmount(amount: number, decimals: number) {
  return BigInt(Math.round(amount * 10 ** decimals));
}

export async function buildUsdcTransferTransaction({
  connection,
  payer,
  merchant,
  amountUsdc,
  usdcMint,
  decimals = 6
}: BuildUsdcTransferTransactionArgs) {
  const payerAta = getAssociatedTokenAddressSync(usdcMint, payer);
  const merchantAta = getAssociatedTokenAddressSync(usdcMint, merchant);
  const transaction = new Transaction();

  let payerAtaInfo: unknown;
  let merchantAtaInfo: unknown;

  try {
    [payerAtaInfo, merchantAtaInfo] = await Promise.all([
      connection.getAccountInfo(payerAta, "confirmed"),
      connection.getAccountInfo(merchantAta, "confirmed")
    ]);
  } catch (error) {
    throw error;
  }

  if (!payerAtaInfo) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        payer,
        payerAta,
        payer,
        usdcMint
      )
    );
  }

  if (!merchantAtaInfo) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        payer,
        merchantAta,
        merchant,
        usdcMint
      )
    );
  }

  transaction.add(
    createTransferCheckedInstruction(
      payerAta,
      usdcMint,
      merchantAta,
      payer,
      toAtomicAmount(amountUsdc, decimals),
      decimals
    )
  );

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = payer;
  transaction.recentBlockhash = latestBlockhash.blockhash;

  return transaction;
}
