"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { cn } from "../lib/utils";
import { hasExplicitSolanaTreasuryAddress } from "../lib/solana/config";

export function NetworkStatus() {
  const { connected } = useWallet();
  const isReady = hasExplicitSolanaTreasuryAddress();

  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-200">
      <span
        className={cn(
          "h-2.5 w-2.5 rounded-full animate-pulse",
          isReady ? "bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.9)]" : "bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.8)]"
        )}
      />
      {isReady ? (connected ? "Solana Treasury Live" : "Treasury Ready") : "Treasury Setup Required"}
    </div>
  );
}
