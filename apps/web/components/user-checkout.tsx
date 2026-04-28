"use client";

import { BrainCircuit, ShieldCheck, Sparkles, Wallet2 } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { getSolanaMerchantAddress, hasExplicitSolanaTreasuryAddress } from "../lib/solana/config";
import { NetworkStatus } from "./network-status";
import { Badge, Card, Switch } from "./ui";
import { useSentinelStore } from "../hooks/useSentinelStore";

function shortenAddress(address: string) {
  return address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}

export function UserCheckout() {
  const { connected } = useWallet();
  const isZkShielded = useSentinelStore((state) => state.isZkShielded);
  const setZkShielded = useSentinelStore((state) => state.setZkShielded);
  const allocationStrategy = useSentinelStore((state) => state.allocationStrategy);
  const merchantAddress = getSolanaMerchantAddress();
  const hasExplicitTreasury = hasExplicitSolanaTreasuryAddress();

  return (
    <Card className="space-y-6 overflow-hidden border-cyan-400/20">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.24em] text-cyan-200">Checkout Intelligence</div>
          <h3 className="font-display text-2xl text-white sm:text-3xl">AI-guided settlement playbook</h3>
          <p className="max-w-2xl text-sm leading-6 text-slate-300">
            SentinelPay keeps the customer experience simple while the treasury layer decides how much should remain
            liquid in USDC and how much can be routed toward Ondo USDY yield.
          </p>
        </div>
        <Badge className="w-fit gap-2">
          <ShieldCheck className="h-3.5 w-3.5" />
          Shielded Flow
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <NetworkStatus />
        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-200">
          {connected ? "Wallet Connected" : "Wallet Not Connected"}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-4 sm:p-5">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm text-slate-400">Preferred settlement</div>
              <div className="mt-1 text-3xl font-semibold text-white sm:text-4xl">USDC</div>
            </div>
            <div className="rounded-3xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-left sm:text-right">
              <div className="text-xs uppercase tracking-[0.18em] text-cyan-200">Allocation</div>
              <div className="text-2xl font-semibold text-white">{allocationStrategy}% liquid</div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <BrainCircuit className="h-5 w-5 text-cyan-300" />
                <div>
                  <div className="font-medium text-white">Treasury AI</div>
                  <div className="text-sm text-slate-400">Business labels, not blockchain noise.</div>
                </div>
              </div>
              <Switch checked={isZkShielded} onCheckedChange={setZkShielded} />
            </div>

            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
              <p>
                {isZkShielded
                  ? "ZK-shielded mode is active, so preferred users see a softer price path while the treasury still settles in USDC."
                  : "Standard mode is active, so every payment settles at face value before treasury allocation logic kicks in."}
              </p>
              <p className="text-cyan-200">
                The live split keeps {allocationStrategy}% in liquid USDC and routes {100 - allocationStrategy}% toward the yield sleeve.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-gradient-to-br from-cyan-400/15 via-slate-900 to-slate-950 p-4 sm:p-5">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-slate-300">
              <Wallet2 className="h-5 w-5 text-cyan-300" />
              Solana Mainnet Treasury
            </div>
            <div>
              <div className="text-sm text-slate-400">Merchant vault</div>
              <div className="mt-1 font-mono text-sm text-white">
                {shortenAddress(merchantAddress)}
              </div>
              {!hasExplicitTreasury ? (
                <div className="mt-2 text-xs text-amber-200">
                  Using fallback treasury key. Set `NEXT_PUBLIC_SOLANA_TREASURY_ADDRESS` for production.
                </div>
              ) : null}
            </div>
            <div>
              <div className="text-sm text-slate-400">Customer outcome</div>
              <div className="mt-1 text-2xl font-semibold text-white sm:text-3xl">Fast USDC settlement</div>
            </div>
            <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Atomic checkout plus treasury routing
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
