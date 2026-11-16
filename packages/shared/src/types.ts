export type Cluster = "devnet" | "mainnet-beta";
export type PublicConfig = {
  cluster: Cluster;
  usdcMint: string;
  swapEnabled: boolean;
  treasuryEnabled: boolean;
  rwaMint: string | null;
};
export type Merchant = {
  walletAddress: string;
  name: string;
  liquidBps: number;
  reserveAtomic: string;
  upcomingExpensesAtomic: string;
  eligibilityAcknowledged: boolean;
};
export type Invoice = {
  id: string;
  merchantWallet: string;
  merchantName: string;
  title: string;
  amountAtomic: string;
  mint: string;
  cluster: Cluster;
  status: "open" | "paid" | "cancelled";
  expiresAt: string;
  createdAt: string;
  signature?: string;
  paidLate?: boolean;
};
export type PreparedPayment = {
  attemptId: string;
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
};
export type PaymentRecord = {
  id: string;
  invoiceId: string;
  title: string;
  payer: string;
  amountAtomic: string;
  signature: string;
  cluster: Cluster;
  confirmedAt: string;
  receivedAtomic: string;
  appliedAtomic: string;
  refundedAtomic: string;
  refundableAtomic: string;
  kind: "payment" | "duplicate" | "cancelled";
};
export type PreparedRefund = PreparedPayment & {
  id: string;
  receiptId: string;
  destination: string;
  amountAtomic: string;
  reason: string;
  status: "prepared" | "confirmed" | "failed" | "expired";
  submittedSignature: string | null;
  signature: string | null;
  cluster: Cluster;
};
export type PreparedTrade = {
  id: string;
  direction: "allocate" | "withdraw";
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  submittedSignature: string | null;
};
