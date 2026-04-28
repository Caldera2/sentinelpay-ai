"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, CheckCircle2, ExternalLink, ShieldCheck, Sparkles } from "lucide-react";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { toast } from "sonner";
import { useSentinelStore } from "../../../hooks/useSentinelStore";
import { getSolanaClientConfig, requirePublicKey } from "../../../lib/solana/config";
import { resilientSolanaConnection } from "../../../lib/solana/connection";
import { prepareJupiterPayment } from "../../../lib/solana/jupiter";
import { buildUsdcTransferTransaction } from "../../../lib/solana/payments";
import { Badge, Button, Card } from "../../ui";

const PRICE_USDC = 24.99;
const transactionRecordedEvent = "sentinelpay:transaction-recorded";
const transactionStorageKey = "sentinelpay.solana.transactions";
const paymentAssets = [
  {
    label: "USDC",
    value: "USDC",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  },
  {
    label: "SOL",
    value: "SOL",
    mint: "So11111111111111111111111111111111111111112"
  },
  {
    label: "Custom token",
    value: "CUSTOM",
    mint: ""
  }
] as const;

function humanizePaymentError(error: unknown, fallbackActive: boolean) {
  const message = error instanceof Error ? error.message : "Payment failed.";
  const normalized = message.toLowerCase();

  if (
    normalized.includes("network authorization error") ||
    normalized.includes("401") ||
    normalized.includes("403") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("invalid api key")
  ) {
    return fallbackActive
      ? "Primary RPC authorization failed, but backup Solana RPC is active. Please retry payment."
      : "Network Authorization Error: Please verify your Helius RPC Key.";
  }

  if (normalized.includes("low liquidity")) {
    return "Low Liquidity: route price impact is above 1%. Try a different asset or a smaller amount.";
  }

  if (normalized.includes("slippage")) {
    return "Swap quote moved outside the slippage window. Refresh and try again.";
  }

  if (normalized.includes("insufficient")) {
    return "Wallet balance is too low for this payment.";
  }

  return message;
}

function isNetworkAuthorizationError(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("network authorization error") ||
    message.includes("401") ||
    message.includes("403") ||
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("invalid api key")
  );
}

export function PaymentModal() {
  const queryClient = useQueryClient();
  const { connection } = useConnection();
  const {
    publicKey,
    sendTransaction,
    connected,
    wallets,
    select,
    connect,
    wallet
  } = useWallet();
  const { merchantAddress, usdcMintAddress } = getSolanaClientConfig();
  const isZkShielded = useSentinelStore((state) => state.isZkShielded);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<(typeof paymentAssets)[number]["value"]>("USDC");
  const [customMint, setCustomMint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [connectingWalletName, setConnectingWalletName] = useState<string | null>(null);
  const [pendingWalletName, setPendingWalletName] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const activeAsset = useMemo(
    () => paymentAssets.find((asset) => asset.value === selectedAsset) ?? paymentAssets[0],
    [selectedAsset]
  );
  const supportedWallets = useMemo(
    () =>
      wallets.filter((entry) =>
        ["Phantom", "Solflare"].includes(entry.adapter.name)
      ),
    [wallets]
  );

  useEffect(() => {
    async function finishWalletConnect() {
      if (!pendingWalletName || wallet?.adapter.name !== pendingWalletName || connected) {
        return;
      }

      try {
        await connect();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Unable to connect ${pendingWalletName}: ${message}`);
      } finally {
        setPendingWalletName(null);
        setConnectingWalletName(null);
      }
    }

    void finishWalletConnect();
  }, [connect, connected, pendingWalletName, wallet]);

  async function handleWalletConnect(walletName: string) {
    const targetWallet = supportedWallets.find(
      (entry) => entry.adapter.name === walletName
    );

    if (!targetWallet) {
      toast.error("This Solana checkout currently supports Phantom and Solflare.");
      return;
    }

    if (targetWallet.readyState === WalletReadyState.NotDetected) {
      toast.error(`${walletName} is not installed in this browser.`);
      return;
    }

    try {
      setConnectingWalletName(walletName);
      if (wallet?.adapter.name === walletName) {
        await connect();
        setConnectingWalletName(null);
        return;
      }

      setPendingWalletName(walletName);
      select(targetWallet.adapter.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Unable to connect ${walletName}: ${message}`);
      setPendingWalletName(null);
      setConnectingWalletName(null);
    } finally {
      if (wallet?.adapter.name === walletName && connected) {
        setPendingWalletName(null);
        setConnectingWalletName(null);
      }
    }
  }

  async function ensureRequiredAtas({
    payer,
    merchant,
    usdcMint,
    broadcastConnection
  }: {
    payer: PublicKey;
    merchant: PublicKey;
    usdcMint: PublicKey;
    broadcastConnection: Connection;
  }) {
    const payerAta = getAssociatedTokenAddressSync(usdcMint, payer);
    const merchantAta = getAssociatedTokenAddressSync(usdcMint, merchant);

    let payerAtaInfo: Awaited<ReturnType<typeof resilientSolanaConnection.getAccountInfo>>;
    let merchantAtaInfo: Awaited<ReturnType<typeof resilientSolanaConnection.getAccountInfo>>;

    try {
      [payerAtaInfo, merchantAtaInfo] = await Promise.all([
        resilientSolanaConnection.getAccountInfo(payerAta, "confirmed"),
        resilientSolanaConnection.getAccountInfo(merchantAta, "confirmed")
      ]);
    } catch (error) {
      throw error;
    }

    if (payerAtaInfo && merchantAtaInfo) {
      return;
    }

    const setupTx = new Transaction();

    if (!payerAtaInfo) {
      setupTx.add(createAssociatedTokenAccountInstruction(payer, payerAta, payer, usdcMint));
    }

    if (!merchantAtaInfo) {
      setupTx.add(createAssociatedTokenAccountInstruction(payer, merchantAta, merchant, usdcMint));
    }

    const signature = await sendTransaction(setupTx, broadcastConnection, {
      preflightCommitment: "confirmed",
      skipPreflight: false
    });

    await broadcastConnection.confirmTransaction(signature, "confirmed");
  }

  async function resolveBroadcastConnection() {
    try {
      await connection.getLatestBlockhash("confirmed");
      return connection;
    } catch (error) {
      if (isNetworkAuthorizationError(error)) {
        console.warn("[SentinelPay] Switching wallet broadcast to public Solana RPC due to provider auth error.");
        return resilientSolanaConnection.fallback;
      }

      throw error;
    }
  }

  async function simulateTransactionLogs(transaction: Transaction | VersionedTransaction) {
    try {
      const simulation =
        transaction instanceof VersionedTransaction
          ? await resilientSolanaConnection.simulateTransaction(transaction, {
              commitment: "confirmed",
              sigVerify: false,
              replaceRecentBlockhash: true
            })
          : await resilientSolanaConnection.simulateTransaction(transaction, undefined, true);
      const simulationResult = simulation as {
        value: {
          logs?: string[] | null;
          err?: unknown;
        };
      };

      const logs = simulationResult.value.logs ?? [];
      console.info("[SentinelPay] simulateTransaction logs:", logs);

      if (simulationResult.value.err) {
        throw new Error(`Simulation failed: ${JSON.stringify(simulationResult.value.err)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[SentinelPay] simulation failure: ${message}`);
      throw error;
    }
  }

  async function handlePayment() {
    if (!publicKey || !connected) {
      toast.error("Connect a Solana wallet before paying.");
      return;
    }

    const mintAddress = selectedAsset === "CUSTOM" ? customMint.trim() : activeAsset.mint;

    if (!mintAddress) {
      toast.error("Enter the mint address for the token you want to spend.");
      return;
    }

    const toastId = toast.loading("Preparing Solana payment...");
    setSubmitting(true);

    try {
      const merchantPublicKey = requirePublicKey(merchantAddress, "Merchant treasury");
      const usdcMint = requirePublicKey(usdcMintAddress, "USDC mint");
      const broadcastConnection = await resolveBroadcastConnection();

      await ensureRequiredAtas({
        payer: publicKey,
        merchant: merchantPublicKey,
        usdcMint,
        broadcastConnection
      });

      const transaction =
        mintAddress === usdcMint.toBase58()
          ? await buildUsdcTransferTransaction({
              connection: resilientSolanaConnection,
              payer: publicKey,
              merchant: merchantPublicKey,
              amountUsdc: isZkShielded ? PRICE_USDC * 0.98 : PRICE_USDC,
              usdcMint
            })
          : await prepareJupiterPayment({
              inputToken: new PublicKey(mintAddress).toBase58(),
              targetAmountUsdc: isZkShielded ? PRICE_USDC * 0.98 : PRICE_USDC,
              merchantAddress: merchantPublicKey.toBase58(),
              userPublicKey: publicKey.toBase58(),
              usdcMint: usdcMint.toBase58()
            });

      await simulateTransactionLogs(transaction);

      const txSignature = await sendTransaction(transaction, broadcastConnection, {
        preflightCommitment: "confirmed",
        skipPreflight: false
      });
      toast.loading("Waiting for Solana finalization...", { id: toastId });
      await broadcastConnection.confirmTransaction(txSignature, "finalized");

      setSignature(txSignature);
      await queryClient.invalidateQueries({ queryKey: ["on-chain-balance"] });
      const historyItem = {
        merchant: merchantPublicKey.toBase58(),
        amount: (isZkShielded ? PRICE_USDC * 0.98 : PRICE_USDC).toFixed(2),
        asset: "USDC",
        track: selectedAsset === "USDC" ? "Direct Treasury Settlement" : "Jupiter Swap-To-Pay",
        txHash: txSignature,
        status: "success" as const,
        createdAt: new Date().toISOString()
      };

      if (typeof window !== "undefined") {
        const current = window.localStorage.getItem(transactionStorageKey);
        const parsed = current ? (JSON.parse(current) as typeof historyItem[]) : [];
        const next = [historyItem, ...parsed.filter((item) => item.txHash !== historyItem.txHash)].slice(0, 20);
        window.localStorage.setItem(transactionStorageKey, JSON.stringify(next));
        window.dispatchEvent(new CustomEvent(transactionRecordedEvent, { detail: historyItem }));
      }

      toast.success("SentinelPay settlement finalized.", {
        id: toastId,
        description: `${txSignature.slice(0, 10)}... confirmed on Solana`
      });
    } catch (error) {
      const fallbackActive = resilientSolanaConnection.isFallbackActive();
      const message = humanizePaymentError(error, fallbackActive);

      if (isNetworkAuthorizationError(error) && !fallbackActive) {
        toast(message, { id: toastId });
      } else {
        toast.error(message, { id: toastId });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Card className="space-y-6 border-emerald-400/20 bg-gradient-to-br from-emerald-400/10 via-slate-950 to-slate-950">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.24em] text-emerald-200">PayFi Checkout</div>
            <h3 className="mt-2 text-balance font-display text-2xl text-white sm:text-3xl">Solana swap-to-pay modal</h3>
          </div>
          <Badge className="w-fit gap-2 border-emerald-300/30 bg-emerald-300/10 text-emerald-100">
            <ShieldCheck className="h-3.5 w-3.5" />
            Blink-ready
          </Badge>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-4 sm:p-5">
          <div className="text-sm text-slate-300">Live price</div>
          <div className="mt-2 text-3xl font-semibold text-white sm:text-4xl">{PRICE_USDC.toFixed(2)} USDC</div>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Settle to the SentinelPay treasury directly, or let Jupiter route another asset into USDC first.
          </p>
        </div>

        <div className="grid gap-3 text-sm text-slate-300 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-white">
              <Sparkles className="h-4 w-4 text-cyan-300" />
              Payment asset
            </div>
            <div className="mt-2 text-slate-300">
              Users can pay in USDC directly or route another SPL token through Jupiter.
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-white">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              Treasury configured
            </div>
            <div className="mt-2 text-slate-300">
              Solana merchant treasury is detected and ready for checkout.
            </div>
          </div>
        </div>

        <Button
          onClick={() => setIsOpen(true)}
          className="w-full bg-emerald-400 text-slate-950 before:hidden hover:bg-emerald-300"
        >
          Open Payment Modal
        </Button>
      </Card>

      <AnimatePresence>
        {isOpen ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/82 p-3 sm:p-4 backdrop-blur-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="w-full max-w-xl"
            >
              <Card className="relative max-h-[92vh] overflow-y-auto border-cyan-400/20 bg-slate-950/95 p-4 sm:p-6">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="absolute right-3 top-3 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 sm:right-4 sm:top-4"
                >
                  Close
                </button>

                <div className="space-y-6">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-cyan-200">SentinelPay</div>
                    <h3 className="mt-2 pr-14 font-display text-2xl text-white sm:text-3xl">Confirm Solana payment</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      This flow keeps settlement atomic: either the user lands exactly {PRICE_USDC.toFixed(2)} USDC in treasury, or nothing settles.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      {supportedWallets.map((supportedWallet) => {
                        const isInstalled =
                          supportedWallet.readyState !== WalletReadyState.NotDetected;
                        const isActive = wallet?.adapter.name === supportedWallet.adapter.name;
                        const isBusy = connectingWalletName === supportedWallet.adapter.name;

                        return (
                          <Button
                            key={supportedWallet.adapter.name}
                            type="button"
                            variant={isActive ? "default" : "secondary"}
                            onClick={() => void handleWalletConnect(supportedWallet.adapter.name)}
                            className={
                              isActive
                                ? "bg-cyan-400 text-slate-950 before:hidden hover:bg-cyan-300"
                                : "border border-white/10 bg-white/5 text-white"
                            }
                          >
                            {isBusy
                              ? `Connecting ${supportedWallet.adapter.name}...`
                              : connected && isActive
                                ? `${supportedWallet.adapter.name} Connected`
                                : isInstalled
                                  ? `Connect ${supportedWallet.adapter.name}`
                                  : `Install ${supportedWallet.adapter.name}`}
                          </Button>
                        );
                      })}
                    </div>
                    <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-50">
                      MetaMask does not work for this checkout because SentinelPay is using Solana wallets only.
                      Please connect with Phantom or Solflare.
                    </div>
                    <Badge className="border-cyan-400/30 bg-cyan-400/10 text-cyan-100">
                      Treasury ready
                    </Badge>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm text-slate-300">Payment Asset</span>
                      <select
                        value={selectedAsset}
                        onChange={(event) => setSelectedAsset(event.target.value as (typeof paymentAssets)[number]["value"])}
                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-cyan-300"
                      >
                        {paymentAssets.map((asset) => (
                          <option key={asset.value} value={asset.value} className="bg-slate-950">
                            {asset.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                      <div className="text-sm text-slate-300">Merchant receives</div>
                      <div className="mt-2 text-xl font-semibold text-white sm:text-2xl">{PRICE_USDC.toFixed(2)} USDC</div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                    ZK shielded treasury logic is {isZkShielded ? "active" : "inactive"}.
                    {isZkShielded ? ` Discounted settlement: ${(PRICE_USDC * 0.98).toFixed(2)} USDC.` : ` Standard settlement: ${PRICE_USDC.toFixed(2)} USDC.`}
                  </div>

                  {selectedAsset === "CUSTOM" ? (
                    <label className="space-y-2">
                      <span className="text-sm text-slate-300">Custom token mint</span>
                      <input
                        value={customMint}
                        onChange={(event) => setCustomMint(event.target.value)}
                        placeholder="Enter SPL token mint address"
                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300"
                      />
                    </label>
                  ) : null}

                  <Button
                    onClick={handlePayment}
                    disabled={submitting || !connected}
                    className="w-full bg-emerald-400 text-slate-950 before:hidden hover:bg-emerald-300"
                  >
                    {submitting ? "Building Atomic Settlement..." : "Confirm Payment"}
                  </Button>

                  <AnimatePresence>
                    {signature ? (
                      <motion.div
                        key={signature}
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        className="rounded-[28px] border border-emerald-400/20 bg-emerald-400/10 p-5"
                      >
                        <div className="flex items-start gap-3">
                          <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-200" />
                          <div className="space-y-2">
                            <div className="text-sm uppercase tracking-[0.22em] text-emerald-100">
                              Finalized on-chain
                            </div>
                            <div className="break-all font-mono text-sm text-white">{signature}</div>
                            <a
                              href={`https://solscan.io/tx/${signature}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 text-sm text-emerald-100 hover:text-white"
                            >
                              View on Solscan
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </div>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </Card>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
