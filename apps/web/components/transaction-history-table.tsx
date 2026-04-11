"use client";

import { useEffect, useState } from "react";
import { apiBaseUrl, getSessionToken } from "../lib/api";
import { Card } from "./ui";

type TransactionItem = {
  merchant: string;
  amount: string;
  track: string;
  txHash: string;
  status: string;
  createdAt: string;
};

const fallbackItems: TransactionItem[] = [
  {
    merchant: "0x0...bEEF",
    amount: "0.10",
    track: "PayFi",
    txHash: "0xsentinel-demo-001",
    status: "success",
    createdAt: new Date().toISOString()
  },
  {
    merchant: "0x0...Cafe",
    amount: "0.32",
    track: "DeFi",
    txHash: "0xsentinel-demo-002",
    status: "success",
    createdAt: new Date(Date.now() - 3_600_000).toISOString()
  }
];

export function TransactionHistoryTable() {
  const [items, setItems] = useState<TransactionItem[]>(fallbackItems);

  useEffect(() => {
    const token = getSessionToken();

    if (!token) {
      return;
    }

    fetch(`${apiBaseUrl}/payments/history`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })
      .then(async (response) => {
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { items: TransactionItem[] };
        if (payload.items.length > 0) {
          setItems(payload.items);
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <Card className="overflow-hidden">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-cyan-200">Merchant Portal</div>
          <h3 className="mt-2 font-display text-2xl text-white">Transaction history</h3>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm text-slate-200">
          <thead className="text-xs uppercase tracking-[0.18em] text-slate-400">
            <tr>
              <th className="pb-4">Merchant</th>
              <th className="pb-4">Amount (HSK)</th>
              <th className="pb-4">Track</th>
              <th className="pb-4">Status</th>
              <th className="pb-4">Tx Hash</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.txHash} className="border-t border-white/10">
                <td className="py-4">{item.merchant}</td>
                <td className="py-4">{item.amount}</td>
                <td className="py-4">{item.track}</td>
                <td className="py-4 capitalize text-emerald-300">{item.status}</td>
                <td className="py-4 font-mono text-xs text-slate-400">{item.txHash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

