"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { VersionedTransaction } from "@solana/web3.js";
import {
  encodeBase58,
  formatUsdc,
  type PaymentRecord,
  type PreparedRefund,
} from "@sentinelpay/shared";
import { toast } from "sonner";
import { fetchApiJson } from "../lib/api";
import { confirmSignature, explorerUrl } from "../lib/solana/connection";
import { Button, Card } from "./ui";

export function RefundOperations({
  wallet,
  selected,
  onClose,
}: {
  wallet: string;
  selected: PaymentRecord | null;
  onClose: () => void;
}) {
  const { publicKey, signTransaction } = useWallet(),
    { connection } = useConnection();
  const queries = useQueryClient(),
    requestId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [offset, setOffset] = useState(0);
  const pending = useQuery({
    queryKey: ["refund-pending", wallet],
    queryFn: () => fetchApiJson<PreparedRefund | null>("/refunds/pending"),
    retry: false,
  });
  const history = useQuery({
    queryKey: ["refund-history", wallet, offset],
    queryFn: () =>
      fetchApiJson<{ items: PreparedRefund[] }>(
        `/refunds/history?limit=20&offset=${offset}`,
      ),
    retry: false,
  });
  useEffect(() => {
    requestId.current = null;
    setAmount(selected ? formatUsdc(selected.refundableAtomic) : "");
    setReason(
      selected?.kind === "duplicate"
        ? "Duplicate payment"
        : selected?.kind === "cancelled"
          ? "Cancelled invoice"
          : "",
    );
  }, [selected]);
  async function refresh() {
    await Promise.all(
      ["refund-pending", "refund-history", "history", "summary", "balance"].map(
        (name) => queries.invalidateQueries({ queryKey: [name, wallet] }),
      ),
    );
  }
  async function finish(result: { pending: boolean }) {
    await refresh();
    if (result.pending)
      toast(
        "Refund submitted. Check its receipt before preparing another refund.",
      );
    else {
      toast.success("Refund verified on-chain.");
      onClose();
    }
  }
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (
      busy ||
      !publicKey ||
      publicKey.toBase58() !== wallet ||
      !signTransaction
    )
      return;
    setBusy(true);
    try {
      requestId.current ||= crypto.randomUUID();
      const prepared =
        pending.data ||
        (await fetchApiJson<PreparedRefund>("/refunds/transaction", {
          method: "POST",
          body: JSON.stringify({
            receiptId: selected?.id,
            amountUsdc: amount,
            reason,
            requestId: requestId.current,
          }),
        }));
      let signature = prepared.submittedSignature;
      if (!signature) {
        const transaction = VersionedTransaction.deserialize(
            Uint8Array.from(atob(prepared.transaction), (c) => c.charCodeAt(0)),
          ),
          message = transaction.message.serialize();
        const signed = await signTransaction(transaction),
          signedMessage = signed.message.serialize();
        if (
          message.length !== signedMessage.length ||
          !message.every((byte, index) => byte === signedMessage[index])
        )
          throw new Error(
            "Wallet changed the refund transaction. Review it before retrying.",
          );
        if (signed.signatures[0].every((byte) => byte === 0))
          throw new Error("Wallet did not sign the refund.");
        signature = encodeBase58(signed.signatures[0]);
        const staged = await fetchApiJson<{ pending: boolean }>(
          `/refunds/${prepared.id}/confirm`,
          { method: "POST", body: JSON.stringify({ signature }) },
        );
        if (!staged.pending) {
          await finish(staged);
          return;
        }
        try {
          await connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: false,
            preflightCommitment: "confirmed",
            maxRetries: 3,
          });
        } catch {
          /* The server retains the signature even if the broadcast response is lost. */
        }
      }
      try {
        await confirmSignature(
          connection,
          signature,
          prepared.lastValidBlockHeight,
        );
      } catch {
        /* The server independently determines refund success. */
      }
      await finish(
        await fetchApiJson<{ pending: boolean }>(
          `/refunds/${prepared.id}/confirm`,
          { method: "POST", body: JSON.stringify({ signature }) },
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to verify refund.",
      );
    } finally {
      setBusy(false);
      await pending.refetch();
    }
  }
  async function expire() {
    if (!pending.data || busy) return;
    setBusy(true);
    try {
      const result = await fetchApiJson<{ confirmed: boolean }>(
        `/refunds/${pending.data.id}/expire`,
        { method: "POST", body: "{}" },
      );
      await refresh();
      toast(
        result.confirmed
          ? "An existing refund receipt was recovered."
          : "Expired refund request closed. You can prepare a replacement.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Refund status is uncertain.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="space-y-5" id="refunds">
      <div>
        <h2 className="text-2xl font-semibold">
          Refunds and payment exceptions
        </h2>
        <p className="mt-2 text-sm leading-7 text-slate-400">
          Refunds return USDC to the original verified payer. Review each
          transaction in your merchant wallet; SOL fees are additional.
        </p>
      </div>
      {pending.error ? (
        <div role="alert">
          <p>Refund status is unavailable. Check again before sending funds.</p>
          <Button onClick={() => void pending.refetch()}>
            Retry refund status
          </Button>
        </div>
      ) : pending.isLoading ? (
        <p role="status">Checking pending refunds…</p>
      ) : pending.data ? (
        <div className="space-y-3 rounded-2xl border border-amber-300/30 p-4">
          <p className="text-amber-100">
            Pending refund: {formatUsdc(pending.data.amountAtomic)} USDC
          </p>
          <p className="break-all text-sm text-slate-400">
            To {pending.data.destination}
          </p>
          {pending.data.submittedSignature && (
            <a
              href={explorerUrl(
                pending.data.submittedSignature,
                pending.data.cluster,
              )}
              target="_blank"
              rel="noreferrer"
              className="block text-cyan-200 underline"
            >
              View refund transaction
            </a>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={busy || !signTransaction}
              onClick={() => void submit()}
            >
              {pending.data.submittedSignature
                ? "Check refund receipt"
                : "Review pending refund"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void expire()}
            >
              Resolve expired refund
            </Button>
          </div>
        </div>
      ) : selected ? (
        <form
          onSubmit={(event) => void submit(event)}
          className="space-y-4 rounded-2xl border border-cyan-300/20 p-4"
        >
          <p className="font-medium">Refund {selected.title}</p>
          <p className="text-sm text-slate-400">
            Remaining refundable: {formatUsdc(selected.refundableAtomic)} USDC
          </p>
          <p className="break-all text-sm">Original payer: {selected.payer}</p>
          <label className="block text-sm">
            Refund amount (USDC)
            <input
              required
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                requestId.current = null;
              }}
              className="mt-2 w-full rounded-2xl border border-white/15 bg-slate-900 p-3"
            />
          </label>
          <label className="block text-sm">
            Refund reason
            <input
              required
              maxLength={500}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                requestId.current = null;
              }}
              className="mt-2 w-full rounded-2xl border border-white/15 bg-slate-900 p-3"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              disabled={
                busy || !signTransaction || publicKey?.toBase58() !== wallet
              }
            >
              {busy ? "Working…" : "Review refund in wallet"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Close refund form
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-slate-400">
          Choose Refund beside a verified payment to issue a full or partial
          refund.
        </p>
      )}
      {history.error ? (
        <p role="alert">Refund history is unavailable.</p>
      ) : history.isLoading ? (
        <p role="status">Loading refund history…</p>
      ) : !history.data?.items.length ? (
        <p className="text-sm text-slate-400">No refunds on this page.</p>
      ) : (
        <ul className="space-y-3">
          {history.data.items.map((item) => (
            <li
              key={item.id}
              className="rounded-2xl border border-white/10 p-4"
            >
              <p>
                {formatUsdc(item.amountAtomic)} USDC · {item.status}
              </p>
              <p className="mt-1 text-sm text-slate-400">{item.reason}</p>
              {item.signature && (
                <a
                  className="mt-2 block text-sm text-cyan-200 underline"
                  href={explorerUrl(item.signature, item.cluster)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Verified refund receipt
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-3">
        <Button
          variant="secondary"
          disabled={offset === 0 || history.isFetching}
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          Previous refunds
        </Button>
        <Button
          variant="secondary"
          disabled={history.data?.items.length !== 20 || history.isFetching}
          onClick={() => setOffset(offset + 20)}
        >
          Next refunds
        </Button>
      </div>
    </Card>
  );
}
