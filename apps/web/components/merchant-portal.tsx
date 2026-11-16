"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "./wallet-button";
import { VersionedTransaction } from "@solana/web3.js";
import {
  encodeBase58,
  formatUsdc,
  type Invoice,
  type Merchant,
  type PaymentRecord,
  type PreparedTrade,
  type PublicConfig,
  type suggestPaymentStrategy,
} from "@sentinelpay/shared";
import { toast } from "sonner";
import { useSession } from "../hooks/useSession";
import { fetchApiJson } from "../lib/api";
import { confirmSignature, explorerUrl } from "../lib/solana/connection";
import { ConnectWalletFlow } from "./connect-wallet-flow";
import { Button, Card } from "./ui";
import { RefundOperations } from "./refund-operations";

const inputClass =
  "mt-2 w-full rounded-2xl border border-white/15 bg-slate-900 px-4 py-3 text-white outline-none focus:border-cyan-300";
type Plan = ReturnType<typeof suggestPaymentStrategy>;

function TreasuryPolicy({
  merchant,
  config,
}: {
  merchant: Merchant;
  config: PublicConfig;
}) {
  const [name, setName] = useState(merchant.name);
  const [liquid, setLiquid] = useState(merchant.liquidBps / 100);
  const [reserve, setReserve] = useState(formatUsdc(merchant.reserveAtomic));
  const [expenses, setExpenses] = useState(
    formatUsdc(merchant.upcomingExpensesAtomic),
  );
  const [eligibility, setEligibility] = useState(
    merchant.eligibilityAcknowledged,
  );
  const [busy, setBusy] = useState(false);
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const queries = useQueryClient();
  const plan = useQuery({
    queryKey: ["plan", merchant.walletAddress],
    queryFn: () => fetchApiJson<Plan>("/treasury/plan"),
    retry: false,
  });
  const pending = useQuery({
    queryKey: ["treasury-pending", merchant.walletAddress],
    enabled: config.treasuryEnabled,
    queryFn: () => fetchApiJson<PreparedTrade | null>("/treasury/pending"),
    retry: false,
  });
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await fetchApiJson("/merchant", {
        method: "PATCH",
        body: JSON.stringify({
          name,
          liquidBps: Math.round(liquid * 100),
          reserveUsdc: reserve,
          upcomingExpensesUsdc: expenses,
          eligibilityAcknowledged: eligibility,
        }),
      });
      await queries.invalidateQueries({
        queryKey: ["merchant", merchant.walletAddress],
      });
      await queries.invalidateQueries({
        queryKey: ["plan", merchant.walletAddress],
      });
      toast.success("Cash reserve policy saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save policy.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function trade(direction: "allocate" | "withdraw") {
    if (!publicKey || !signTransaction || busy) return;
    setBusy(true);
    try {
      const prepared =
        pending.data ||
        (await fetchApiJson<PreparedTrade>("/treasury/transaction", {
          method: "POST",
          body: JSON.stringify({
            direction,
            requestId: crypto.randomUUID(),
            ...(direction === "allocate" && plan.data
              ? { amountAtomic: plan.data.suggestedAllocationAtomic }
              : {}),
          }),
        }));
      let signature = prepared.submittedSignature;
      if (!signature) {
        const transaction = VersionedTransaction.deserialize(
          Uint8Array.from(atob(prepared.transaction), (character) =>
            character.charCodeAt(0),
          ),
        );
        const signed = await signTransaction(transaction);
        if (signed.signatures[0].every((byte) => byte === 0))
          throw new Error("Wallet did not sign the transaction.");
        signature = encodeBase58(signed.signatures[0]);
        // Persist this candidate before broadcast, so a lost RPC response can be recovered safely.
        await fetchApiJson(`/treasury/${prepared.id}/confirm`, {
          method: "POST",
          body: JSON.stringify({ signature }),
        });
        try {
          await connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: false,
            preflightCommitment: "confirmed",
            maxRetries: 3,
          });
        } catch {
          /* Pending request retains the signature for recovery. */
        }
      }
      let receipt = await fetchApiJson<{ pending: boolean }>(
        `/treasury/${prepared.id}/confirm`,
        { method: "POST", body: JSON.stringify({ signature }) },
      );
      if (receipt.pending) {
        try {
          await confirmSignature(
            connection,
            signature,
            prepared.lastValidBlockHeight,
          );
        } catch {
          /* The server determines the final result. */
        }
        receipt = await fetchApiJson<{ pending: boolean }>(
          `/treasury/${prepared.id}/confirm`,
          { method: "POST", body: JSON.stringify({ signature }) },
        );
      }
      if (receipt.pending) {
        toast(
          "Treasury receipt is still pending. Check it before preparing another trade.",
        );
        return;
      }
      await queries.invalidateQueries({
        queryKey: ["balance", merchant.walletAddress],
      });
      await plan.refetch();
      toast.success("Treasury swap finalized.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to allocate funds.",
      );
    } finally {
      setBusy(false);
      await pending.refetch();
    }
  }
  async function expireTrade() {
    if (!pending.data) return;
    setBusy(true);
    try {
      await fetchApiJson(`/treasury/${pending.data.id}/expire`, {
        method: "POST",
        body: "{}",
      });
      await pending.refetch();
      toast(
        "Expired request discarded. Check your wallet for any earlier settled trade.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to discard request.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="space-y-5 border-cyan-400/20">
      <div>
        <p className="text-xs uppercase tracking-widest text-cyan-200">
          Treasury policy
        </p>
        <h2 className="mt-2 text-2xl font-semibold">
          Protect your operating cash
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          These saved rules guide merchant-approved allocations. Checkout
          settles the full invoice in USDC; treasury swaps require a separate
          wallet signature.
        </p>
      </div>
      <form onSubmit={(event) => void save(event)} className="space-y-4">
        <label className="block text-sm">
          Business name
          <input
            required
            maxLength={100}
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          Keep liquid: {liquid}%
          <input
            aria-label="Percentage to keep liquid"
            type="range"
            min={0}
            max={100}
            value={liquid}
            onChange={(event) => setLiquid(Number(event.target.value))}
            className="mt-3 w-full accent-cyan-300"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            Minimum reserve (USDC)
            <input
              required
              inputMode="decimal"
              className={inputClass}
              value={reserve}
              onChange={(event) => setReserve(event.target.value)}
            />
          </label>
          <label className="text-sm">
            Upcoming expenses (USDC)
            <input
              required
              inputMode="decimal"
              className={inputClass}
              value={expenses}
              onChange={(event) => setExpenses(event.target.value)}
            />
          </label>
        </div>
        {config.treasuryEnabled && (
          <label className="flex items-start gap-3 text-sm leading-6 text-slate-300">
            <input
              type="checkbox"
              className="mt-1"
              checked={eligibility}
              onChange={(event) => setEligibility(event.target.checked)}
            />
            <span>
              I have reviewed{" "}
              <a
                href="https://ondo.finance/usdy"
                target="_blank"
                rel="noreferrer"
                className="text-cyan-200 underline"
              >
                the provider’s eligibility and redemption requirements
              </a>
              . This acknowledgment is not an identity verification.
            </span>
          </label>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Working…" : "Save treasury policy"}
        </Button>
      </form>
      <div className="rounded-2xl border border-white/10 p-4">
        <p className="font-medium">Cash reserve assistant</p>
        {plan.data && !plan.isError ? (
          <>
            <p className="mt-2 text-sm text-cyan-200">
              Suggested surplus:{" "}
              {formatUsdc(plan.data.suggestedAllocationAtomic)} USDC
            </p>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              {plan.data.reason}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-400">
            {plan.error
              ? "Live balance is unavailable, so no allocation is recommended."
              : "Reading your current wallet balance…"}
          </p>
        )}
        <p className="mt-3 text-xs text-slate-400">
          Uses your live balance and saved cash rules. No market forecast or
          fixed return is assumed.
        </p>
      </div>
      {config.treasuryEnabled ? (
        pending.data ? (
          <div className="space-y-3 rounded-2xl border border-amber-300/30 p-4">
            <p className="text-sm text-amber-100">
              A treasury request is pending. Resolve it before creating another
              trade.
            </p>
            {pending.data.submittedSignature && (
              <a
                className="block text-sm text-cyan-200 underline"
                href={explorerUrl(
                  pending.data.submittedSignature,
                  config.cluster,
                )}
                target="_blank"
                rel="noreferrer"
              >
                View submitted transaction
              </a>
            )}
            <Button
              disabled={busy}
              onClick={() => void trade(pending.data!.direction)}
            >
              {pending.data.submittedSignature
                ? "Check treasury receipt"
                : "Review pending transaction"}
            </Button>
            <Button
              disabled={busy}
              variant="ghost"
              onClick={() => void expireTrade()}
            >
              Discard expired request
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={
                busy ||
                !merchant.eligibilityAcknowledged ||
                !plan.data ||
                plan.isError ||
                plan.data.suggestedAllocationAtomic === "0" ||
                pending.isLoading ||
                pending.isError
              }
              onClick={() => void trade("allocate")}
            >
              Review allocation in wallet
            </Button>
            <Button
              variant="secondary"
              disabled={
                busy ||
                !merchant.eligibilityAcknowledged ||
                pending.isLoading ||
                pending.isError
              }
              onClick={() => void trade("withdraw")}
            >
              Withdraw all yield tokens to USDC
            </Button>
          </div>
        )
      ) : (
        <p className="rounded-2xl bg-amber-300/10 p-4 text-sm leading-7 text-amber-100">
          Yield trading is currently unavailable. Your USDC remains available in
          your wallet.
        </p>
      )}
    </Card>
  );
}

export function MerchantPortal() {
  const wallet = useWallet();
  const session = useSession();
  const queries = useQueryClient();
  const address = wallet.publicKey?.toBase58();
  const authorized = Boolean(
    address && session.data?.walletAddress === address,
  );
  const [creating, setCreating] = useState(false);
  const [cancellingInvoice, setCancellingInvoice] = useState<string | null>(
    null,
  );
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [offset, setOffset] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [refundReceipt, setRefundReceipt] = useState<PaymentRecord | null>(
    null,
  );
  const createId = useRef<string | null>(null);
  const merchant = useQuery({
    queryKey: ["merchant", address],
    enabled: authorized,
    queryFn: () => fetchApiJson<Merchant>("/merchant"),
    retry: false,
  });
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => fetchApiJson<PublicConfig>("/config"),
    retry: false,
  });
  const invoices = useQuery({
    queryKey: ["invoices", address, offset],
    enabled: authorized,
    queryFn: () =>
      fetchApiJson<{ items: Invoice[] }>(`/invoices?limit=20&offset=${offset}`),
    retry: false,
  });
  const history = useQuery({
    queryKey: ["history", address, historyOffset],
    enabled: authorized,
    queryFn: () =>
      fetchApiJson<{ items: PaymentRecord[] }>(
        `/payments/history?limit=20&offset=${historyOffset}`,
      ),
    retry: false,
  });
  const summary = useQuery({
    queryKey: ["summary", address],
    enabled: authorized,
    queryFn: () =>
      fetchApiJson<{
        revenueAtomic: string;
        paymentCount: number;
        grossRevenueAtomic: string;
        refundedInvoiceAtomic: string;
        outstandingExcessAtomic: string;
      }>("/payments/summary"),
    retry: false,
  });
  const balance = useQuery({
    queryKey: ["balance", address],
    enabled: authorized,
    queryFn: () =>
      fetchApiJson<{ availableUsdcAtomic: string; updatedAt: string }>(
        "/treasury/balance",
      ),
    retry: false,
    refetchInterval: 30_000,
  });
  useEffect(() => {
    setOffset(0);
    setHistoryOffset(0);
    setRefundReceipt(null);
  }, [address]);
  async function logout() {
    try {
      await fetchApiJson("/auth/logout", { method: "POST", body: "{}" });
      queries.setQueryData(["session"], null);
      queries.removeQueries({
        predicate: (query) =>
          !["session", "config"].includes(String(query.queryKey[0])),
      });
      await wallet.disconnect();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to sign out.",
      );
    }
  }
  async function createInvoice(event: FormEvent) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      createId.current ||= crypto.randomUUID();
      await fetchApiJson<Invoice>("/invoices", {
        method: "POST",
        body: JSON.stringify({
          title,
          amountUsdc: amount,
          expiresInHours: 24,
          requestId: createId.current,
        }),
      });
      setTitle("");
      setAmount("");
      createId.current = null;
      setOffset(0);
      await queries.invalidateQueries({ queryKey: ["invoices", address] });
      toast.success("Payment link created.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create invoice.",
      );
    } finally {
      setCreating(false);
    }
  }
  async function cancelInvoice(id: string) {
    if (cancellingInvoice) return;
    setCancellingInvoice(id);
    try {
      await fetchApiJson(`/invoices/${id}/cancel`, {
        method: "POST",
        body: "{}",
      });
      await Promise.all([
        queries.invalidateQueries({ queryKey: ["invoices", address] }),
        queries.invalidateQueries({ queryKey: ["invoice", id] }),
      ]);
      toast.success("Invoice cancelled. New checkout payments are disabled.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to cancel invoice.",
      );
      await invoices.refetch();
    } finally {
      setCancellingInvoice(null);
    }
  }
  async function copyLink(id: string) {
    try {
      await navigator.clipboard.writeText(
        new URL(`/pay/${id}`, window.location.origin).toString(),
      );
      toast.success("Payment link copied.");
    } catch {
      toast.error("Unable to copy. Open the checkout and copy its address.");
    }
  }
  return (
    <main className="grid-shell min-h-screen px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/5 p-5">
          <Link href="/" className="text-lg font-semibold">
            SentinelPay
          </Link>
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs text-cyan-200">
              {config.data
                ? config.data.cluster === "devnet"
                  ? "Devnet · test payments"
                  : "Solana mainnet"
                : "Network unavailable"}
            </span>
            <WalletMultiButton />
            {session.data && (
              <Button variant="secondary" onClick={() => void logout()}>
                Sign out
              </Button>
            )}
          </div>
        </header>
        {session.isLoading ? (
          <Card>
            <p role="status">Checking your session…</p>
          </Card>
        ) : session.error ? (
          <Card>
            <p role="alert">{session.error.message}</p>
            <Button className="mt-4" onClick={() => void session.refetch()}>
              Retry connection
            </Button>
          </Card>
        ) : !authorized ? (
          <ConnectWalletFlow />
        ) : (
          <>
            <div>
              <h1 className="text-3xl font-semibold">Merchant dashboard</h1>
              <p className="mt-2 text-sm text-slate-400">
                Create payment links, reconcile receipts, and manage your cash
                reserve policy.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <p className="text-sm text-slate-400">Net invoice revenue</p>
                <p className="mt-3 break-all text-2xl">
                  {summary.data
                    ? `${formatUsdc(summary.data.revenueAtomic)} USDC`
                    : summary.error
                      ? "Unavailable"
                      : "Loading…"}
                </p>
                {summary.data && (
                  <p className="mt-2 text-xs text-slate-400">
                    Gross {formatUsdc(summary.data.grossRevenueAtomic)} ·
                    Refunded {formatUsdc(summary.data.refundedInvoiceAtomic)}{" "}
                    USDC
                  </p>
                )}
              </Card>
              <Card>
                <p className="text-sm text-slate-400">Available wallet USDC</p>
                <p className="mt-3 break-all text-2xl">
                  {balance.error
                    ? "Unavailable"
                    : balance.data
                      ? formatUsdc(balance.data.availableUsdcAtomic)
                      : "Loading…"}
                </p>
                {balance.data && !balance.error && (
                  <p className="mt-2 text-xs text-slate-400">
                    Updated{" "}
                    {new Date(balance.data.updatedAt).toLocaleTimeString()}
                  </p>
                )}
                {balance.error && (
                  <Button
                    className="mt-2"
                    variant="ghost"
                    onClick={() => void balance.refetch()}
                  >
                    Retry balance
                  </Button>
                )}
              </Card>
              <Card>
                <p className="text-sm text-slate-400">Verified payments</p>
                <p className="mt-3 text-2xl">
                  {summary.data?.paymentCount ??
                    (summary.error ? "Unavailable" : "Loading…")}
                </p>
                {summary.data &&
                  summary.data.outstandingExcessAtomic !== "0" && (
                    <p role="status" className="mt-2 text-sm text-amber-200">
                      {formatUsdc(summary.data.outstandingExcessAtomic)} USDC in
                      extra payments needs review.
                    </p>
                  )}
              </Card>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="space-y-5">
                <div>
                  <p className="text-xs uppercase tracking-widest text-cyan-200">
                    Payment links
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold">
                    Create an invoice
                  </h2>
                </div>
                <form
                  onSubmit={(event) => void createInvoice(event)}
                  className="space-y-4"
                >
                  <label className="block text-sm">
                    Description
                    <input
                      required
                      maxLength={200}
                      className={inputClass}
                      value={title}
                      onChange={(event) => {
                        setTitle(event.target.value);
                        createId.current = null;
                      }}
                      placeholder="What is the customer paying for?"
                    />
                  </label>
                  <label className="block text-sm">
                    Amount in USDC
                    <input
                      required
                      inputMode="decimal"
                      className={inputClass}
                      value={amount}
                      onChange={(event) => {
                        setAmount(event.target.value);
                        createId.current = null;
                      }}
                      placeholder="24.99"
                    />
                  </label>
                  <p className="text-sm leading-7 text-slate-400">
                    Links expire after 24 hours. Customers see your business
                    name, recipient wallet, network, and exact invoice amount.
                  </p>
                  <Button type="submit" disabled={creating || !config.data}>
                    {creating ? "Creating…" : "Create payment link"}
                  </Button>
                </form>
              </Card>
              {merchant.data && config.data ? (
                <TreasuryPolicy
                  key={merchant.data.walletAddress}
                  merchant={merchant.data}
                  config={config.data}
                />
              ) : (
                <Card>
                  <p role="status">
                    {merchant.error?.message || "Loading merchant settings…"}
                  </p>
                </Card>
              )}
            </div>
            <Card className="space-y-5">
              <h2 className="text-2xl font-semibold">Invoices</h2>
              <p className="text-sm text-slate-400">
                Cancel any unpaid invoice, including failed or rejected payment
                attempts. Payments already sent may still settle and can be
                refunded.
              </p>
              {invoices.error ? (
                <p role="alert">{invoices.error.message}</p>
              ) : invoices.isLoading ? (
                <p role="status">Loading invoices…</p>
              ) : !invoices.data?.items.length ? (
                <p className="text-sm text-slate-400">
                  No invoices on this page.
                </p>
              ) : (
                <div className="space-y-3">
                  {invoices.data.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 p-4"
                    >
                      <div className="min-w-0">
                        <p className="break-words font-medium">{item.title}</p>
                        <p className="mt-1 text-sm text-slate-400">
                          {formatUsdc(item.amountAtomic)} USDC ·{" "}
                          {item.status === "open" &&
                          new Date(item.expiresAt) <= new Date()
                            ? "expired"
                            : item.status}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <Link
                          className="self-center text-sm text-cyan-200 underline"
                          href={`/pay/${item.id}`}
                        >
                          Open checkout
                        </Link>
                        <Button
                          variant="secondary"
                          onClick={() => void copyLink(item.id)}
                        >
                          Copy link
                        </Button>
                        {item.status === "open" && (
                          <Button
                            variant="ghost"
                            disabled={Boolean(cancellingInvoice)}
                            onClick={() => void cancelInvoice(item.id)}
                          >
                            {cancellingInvoice === item.id
                              ? "Cancelling…"
                              : "Cancel"}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  disabled={offset === 0 || invoices.isFetching}
                  onClick={() => setOffset(Math.max(0, offset - 20))}
                >
                  Previous invoices
                </Button>
                <Button
                  variant="secondary"
                  disabled={
                    invoices.data?.items.length !== 20 || invoices.isFetching
                  }
                  onClick={() => setOffset(offset + 20)}
                >
                  Next invoices
                </Button>
              </div>
            </Card>
            <Card className="space-y-5">
              <div className="flex flex-wrap justify-between gap-4">
                <h2 className="text-2xl font-semibold">
                  Verified payment history
                </h2>
                <a
                  className="text-sm text-cyan-200 underline"
                  href={`/api/backend/payments/export?limit=20&offset=${historyOffset}`}
                >
                  Export this page as CSV
                </a>
              </div>
              {history.error ? (
                <p role="alert">{history.error.message}</p>
              ) : history.isLoading ? (
                <p role="status">Loading payments…</p>
              ) : !history.data?.items.length ? (
                <p className="text-sm text-slate-400">
                  No verified payments on this page.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-left text-sm">
                    <caption className="sr-only">
                      Payments independently verified against finalized Solana
                      transactions
                    </caption>
                    <thead className="text-slate-400">
                      <tr>
                        <th className="pb-3">Invoice</th>
                        <th className="pb-3">Received USDC</th>
                        <th className="pb-3">Confirmed</th>
                        <th className="pb-3">Receipt</th>
                        <th className="pb-3">Refund</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.items.map((payment) => (
                        <tr
                          key={payment.id}
                          className="border-t border-white/10"
                        >
                          <td className="py-4 pr-4">
                            {payment.title}
                            {payment.kind === "duplicate" && (
                              <span className="mt-1 block text-xs text-amber-200">
                                Duplicate transfer
                              </span>
                            )}
                            {payment.kind === "cancelled" && (
                              <span className="mt-1 block text-xs text-amber-200">
                                Payment on cancelled invoice
                              </span>
                            )}
                          </td>
                          <td className="pr-4">
                            {formatUsdc(payment.receivedAtomic)}
                            {payment.refundedAtomic !== "0" && (
                              <span className="mt-1 block text-xs text-slate-400">
                                {formatUsdc(payment.refundedAtomic)} refunded
                              </span>
                            )}
                          </td>
                          <td className="pr-4">
                            {new Date(payment.confirmedAt).toLocaleString()}
                          </td>
                          <td>
                            <a
                              className="text-cyan-200 underline"
                              href={explorerUrl(
                                payment.signature,
                                payment.cluster,
                              )}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View transaction
                            </a>
                          </td>
                          <td>
                            <Button
                              variant="ghost"
                              disabled={payment.refundableAtomic === "0"}
                              onClick={() => setRefundReceipt(payment)}
                            >
                              {payment.refundableAtomic === "0"
                                ? "Fully refunded"
                                : "Refund"}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  disabled={historyOffset === 0 || history.isFetching}
                  onClick={() =>
                    setHistoryOffset(Math.max(0, historyOffset - 20))
                  }
                >
                  Previous payments
                </Button>
                <Button
                  variant="secondary"
                  disabled={
                    history.data?.items.length !== 20 || history.isFetching
                  }
                  onClick={() => setHistoryOffset(historyOffset + 20)}
                >
                  Next payments
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void invoices.refetch();
                    void history.refetch();
                    void summary.refetch();
                  }}
                >
                  Refresh payments
                </Button>
              </div>
            </Card>
            <RefundOperations
              key={address}
              wallet={address!}
              selected={refundReceipt}
              onClose={() => setRefundReceipt(null)}
            />
          </>
        )}
      </div>
    </main>
  );
}
