"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  encodeBase58,
  formatUsdc,
  type Invoice,
  type PreparedPayment,
  type PublicConfig,
} from "@sentinelpay/shared";
import { useQuery } from "@tanstack/react-query";
import { Button, Card } from "./ui";
import { ApiError, fetchApiJson } from "../lib/api";
import { confirmSignature, explorerUrl } from "../lib/solana/connection";

type Pending = { attemptId: string; signature: string };
export function PaymentCheckout({ invoiceId }: { invoiceId: string }) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState("");
  const [inputAsset, setInputAsset] = useState("USDC");
  const requestId = useRef<string | null>(null);
  const key = `sentinelpay.pending.${invoiceId}.${publicKey?.toBase58() || ""}`;
  const invoice = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: () => fetchApiJson<Invoice>(`/public/invoices/${invoiceId}`),
    retry: false,
    refetchInterval: 10000,
  });
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => fetchApiJson<PublicConfig>("/config"),
    retry: false,
  });
  useEffect(() => {
    requestId.current = null;
    setMessage("");
    try {
      const saved = sessionStorage.getItem(key);
      setPending(saved ? (JSON.parse(saved) as Pending) : null);
    } catch {
      setPending(null);
    }
  }, [key]);
  async function reconcile(payment: Pending) {
    const result = await fetchApiJson<{ pending: boolean; invoice?: Invoice;duplicate?:boolean }>(
      `/public/invoices/${invoiceId}/confirm`,
      { method: "POST", body: JSON.stringify(payment) },
    );
    if (result.pending) {
      setMessage(
        "Payment submitted. Waiting for final confirmation; keep this receipt and check again.",
      );
      return;
    }
    sessionStorage.removeItem(key);
    setPending(null);
    setMessage(result.duplicate?"This additional transfer was received and recorded. Contact the merchant about a refund; do not pay again.":"Payment verified on-chain. Your receipt is ready.");
    await invoice.refetch();
  }
  async function pay() {
    if (!publicKey || !signTransaction || !invoice.data || busy || pending)
      return;
    setBusy(true);
    setMessage("");
    try {
      requestId.current ||= crypto.randomUUID();
      const prepared = await fetchApiJson<PreparedPayment>(
        `/public/invoices/${invoiceId}/transaction`,
        {
          method: "POST",
          body: JSON.stringify({
            account: publicKey.toBase58(),
            requestId: requestId.current,
            ...(inputAsset === "SOL"
              ? { inputMint: "So11111111111111111111111111111111111111112" }
              : {}),
          }),
        },
      );
      const bytes = Uint8Array.from(atob(prepared.transaction), (character) =>
        character.charCodeAt(0),
      );
      let transaction: Transaction | VersionedTransaction;
      try {
        transaction = Transaction.from(bytes);
      } catch {
        transaction = VersionedTransaction.deserialize(bytes);
      }
      const signed = await signTransaction(transaction);
      const signatureBytes =
        signed instanceof VersionedTransaction
          ? signed.signatures[0]
          : signed.signature;
      if (!signatureBytes || signatureBytes.every((byte) => byte === 0))
        throw new Error("Wallet did not sign the transaction.");
      const signature = encodeBase58(signatureBytes);
      const payment = { attemptId: prepared.attemptId, signature };
      setPending(payment);
      // Storage is a retry hint only. The server independently verifies every receipt.
      try {
        sessionStorage.setItem(key, JSON.stringify(payment));
      } catch {
        /* Receipt is also kept in component state. */
      }
      setMessage("Payment submitted. Waiting for final confirmation…");
      try {
        await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        });
      } catch {
        /* Keep the known signature even when the broadcast response is lost. */
      }
      try {
        await confirmSignature(
          connection,
          signature,
          prepared.lastValidBlockHeight,
        );
      } catch {
        /* Reconcile against the server even if the browser confirmation path times out. */
      }
      await reconcile(payment);
    } catch (error) {
      if (
        error instanceof ApiError &&
        ["TRANSACTION_FAILED", "TRANSACTION_EXPIRED"].includes(error.code || "")
      ) {
        setPending(null);
        requestId.current = null;
        try {
          sessionStorage.removeItem(key);
        } catch {}
      }
      setMessage(
        error instanceof Error ? error.message : "Unable to complete payment.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await reconcile(pending);
    } catch (error) {
      if (
        error instanceof ApiError &&
        ["TRANSACTION_FAILED", "TRANSACTION_EXPIRED"].includes(error.code || "")
      ) {
        setPending(null);
        requestId.current = null;
        try {
          sessionStorage.removeItem(key);
        } catch {}
      }
      setMessage(
        error instanceof Error ? error.message : "Status check failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (invoice.isLoading)
    return (
      <Card>
        <p role="status">Loading invoice…</p>
      </Card>
    );
  if (invoice.error || !invoice.data)
    return (
      <Card>
        <p role="alert">{invoice.error?.message || "Invoice unavailable."}</p>
      </Card>
    );
  const item = invoice.data;
  const expired = new Date(item.expiresAt).getTime() <= Date.now();
  return (
    <Card className="mx-auto w-full max-w-xl space-y-6 border-cyan-400/20">
      <Link href="/" className="text-sm text-cyan-200">
        SentinelPay
      </Link>
      <div>
        <p className="text-xs uppercase tracking-widest text-cyan-200">
          {item.cluster === "devnet"
            ? "Devnet · test payment"
            : "Solana mainnet"}
        </p>
        <h1 className="mt-3 text-3xl font-semibold">{item.title}</h1>
        <p className="mt-3 text-slate-300">Pay {item.merchantName}</p>
      </div>
      <div className="rounded-3xl border border-white/10 p-5">
        <p className="text-sm text-slate-400">Invoice total</p>
        <p className="mt-2 break-all text-3xl font-semibold">
          {formatUsdc(item.amountAtomic)} USDC
        </p>
        <p className="mt-3 text-xs leading-6 text-slate-400">
          Network fees and token-account creation costs are paid in SOL. Swap
          payments may include additional slippage within the quoted limit.
        </p>
      </div>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-slate-400">Recipient wallet</dt>
          <dd className="mt-1 break-all font-mono">{item.merchantWallet}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Expires</dt>
          <dd>{new Date(item.expiresAt).toLocaleString()}</dd>
        </div>
      </dl>
      {item.status === "paid" ? (
        <div
          role="status"
          className="rounded-2xl bg-emerald-400/10 p-4 text-emerald-200"
        >
          <p>Payment received and verified.</p>
          {item.signature && (
            <a
              className="mt-2 inline-block underline"
              href={explorerUrl(item.signature, item.cluster)}
              target="_blank"
              rel="noreferrer"
            >
              View receipt on Solana Explorer
            </a>
          )}
        </div>
      ) : item.status !== "open" || expired ? (
        <p role="status">
          This invoice is {expired ? "expired" : item.status}.
        </p>
      ) : (
        <>
          <WalletMultiButton />
          {config.data?.swapEnabled && (
            <label className="block text-sm">
              Pay with
              <select
                aria-label="Payment token"
                disabled={busy || Boolean(pending)}
                value={inputAsset}
                onChange={(event) => {
                  requestId.current = null;
                  setInputAsset(event.target.value);
                }}
                className="mt-2 w-full rounded-2xl bg-slate-800 p-3"
              >
                <option>USDC</option>
                <option>SOL</option>
              </select>
            </label>
          )}
          <Button
            className="w-full bg-cyan-400 text-slate-950 before:hidden"
            disabled={
              busy ||
              !publicKey ||
              !signTransaction ||
              Boolean(pending) ||
              !config.data ||
              config.data.cluster !== item.cluster
            }
            onClick={() => void pay()}
          >
            {busy ? "Processing…" : "Pay invoice"}
          </Button>
          {publicKey && !signTransaction && (
            <p role="alert" className="text-sm text-amber-200">
              Choose a wallet that supports transaction signing, such as Phantom
              or Solflare.
            </p>
          )}
        </>
      )}
      {pending && (
        <div className="space-y-3 rounded-2xl border border-amber-400/30 p-4">
          <p className="text-sm text-amber-200">
            A transaction has already been submitted. Check this receipt before
            making another payment.
          </p>
          <a
            className="block break-all text-xs text-cyan-200 underline"
            href={explorerUrl(pending.signature, item.cluster)}
            target="_blank"
            rel="noreferrer"
          >
            {pending.signature}
          </a>
          <Button disabled={busy} onClick={() => void check()}>
            Check payment status
          </Button>
        </div>
      )}
      {message && (
        <p
          role="status"
          aria-live="polite"
          className="text-sm leading-7 text-slate-200"
        >
          {message}
        </p>
      )}
      {config.error && (
        <p role="alert" className="text-sm text-amber-200">
          Payment configuration is unavailable. Try again later.
        </p>
      )}
    </Card>
  );
}
