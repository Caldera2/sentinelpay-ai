"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button, Card } from "./ui";

type TransactionItem = {
  merchant: string;
  amount: string;
  asset: string;
  track: string;
  txHash: string;
  status: "pending" | "success" | "failed";
  createdAt: string;
};

const transactionRecordedEvent = "sentinelpay:transaction-recorded";
const transactionStorageKey = "sentinelpay.solana.transactions";

function shortenAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function shortenHash(value: string) {
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export function TransactionHistoryTable() {
  const [items, setItems] = useState<TransactionItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<TransactionItem | null>(null);

  useEffect(() => {
    function loadHistory() {
      if (typeof window === "undefined") {
        return;
      }

      const payload = window.localStorage.getItem(transactionStorageKey);
      setItems(payload ? (JSON.parse(payload) as TransactionItem[]) : []);
    }

    loadHistory();

    const handleRecorded = (event: Event) => {
      const nextItem = (event as CustomEvent<TransactionItem>).detail;

      setItems((current) => {
        const deduped = current.filter((item) => item.txHash.toLowerCase() !== nextItem.txHash.toLowerCase());
        return [nextItem, ...deduped];
      });
      setSelectedItem(nextItem);
    };

    window.addEventListener(transactionRecordedEvent, handleRecorded as EventListener);

    return () => {
      window.removeEventListener(transactionRecordedEvent, handleRecorded as EventListener);
    };
  }, []);

  return (
    <Card className="overflow-hidden">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-cyan-200">Merchant Portal</div>
          <h3 className="mt-2 font-display text-2xl text-white">Transaction history</h3>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-white/10 bg-white/5 p-5 text-sm text-slate-300">
          No payments recorded yet. Complete a payment and it will appear here automatically.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[720px] w-full text-left text-sm text-slate-200">
            <thead className="text-xs uppercase tracking-[0.18em] text-slate-400">
              <tr>
                <th className="pb-4">Merchant</th>
                <th className="pb-4">Amount</th>
                <th className="pb-4">Track</th>
                <th className="pb-4">Status</th>
                <th className="pb-4">Signature</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.txHash} className="border-t border-white/10">
                  <td className="py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => setSelectedItem(item)}
                      className="w-full rounded-2xl px-3 py-2 text-left transition hover:bg-white/5"
                    >
                      {shortenAddress(item.merchant)}
                    </button>
                  </td>
                  <td className="py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => setSelectedItem(item)}
                      className="w-full rounded-2xl px-3 py-2 text-left transition hover:bg-white/5"
                    >
                      {item.amount}
                      {" "}
                      {item.asset}
                    </button>
                  </td>
                  <td className="py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => setSelectedItem(item)}
                      className="w-full rounded-2xl px-3 py-2 text-left transition hover:bg-white/5"
                    >
                      {item.track}
                    </button>
                  </td>
                  <td className="py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => setSelectedItem(item)}
                      className={`w-full rounded-2xl px-3 py-2 text-left capitalize transition hover:bg-white/5 ${
                        item.status === "success"
                          ? "text-emerald-300"
                          : item.status === "failed"
                            ? "text-rose-300"
                            : "text-amber-200"
                      }`}
                    >
                      {item.status}
                    </button>
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => setSelectedItem(item)}
                      className="w-full rounded-2xl px-3 py-2 text-left font-mono text-xs text-slate-400 transition hover:bg-white/5"
                    >
                      {shortenHash(item.txHash)}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedItem ? (
        <div className="mt-6 rounded-[24px] border border-cyan-400/15 bg-slate-950/60 p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-cyan-200">Transaction Detail</div>
              <h4 className="mt-2 font-display text-xl text-white">{selectedItem.track} settlement</h4>
            </div>
            <Button variant="ghost" onClick={() => setSelectedItem(null)}>
              Close
            </Button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Merchant</div>
              <div className="mt-2 font-mono text-sm text-white">{selectedItem.merchant}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Amount</div>
              <div className="mt-2 text-white">
                {selectedItem.amount} {selectedItem.asset}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Status</div>
              <div className="mt-2 capitalize text-white">{selectedItem.status}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Created</div>
              <div className="mt-2 text-white">{new Date(selectedItem.createdAt).toLocaleString()}</div>
            </div>
          </div>

          <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Transaction Hash</div>
            <div className="mt-2 break-all font-mono text-xs text-cyan-100">{selectedItem.txHash}</div>
            <a
              href={`https://solscan.io/tx/${selectedItem.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-2 text-sm text-cyan-200 hover:text-white"
            >
              View on Solscan
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
