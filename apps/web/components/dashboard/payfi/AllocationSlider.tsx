"use client";

import { ArrowRightLeft, Droplets, Landmark } from "lucide-react";
import { Card } from "../../ui";
import { useSentinelStore } from "../../../hooks/useSentinelStore";

export function AllocationSlider() {
  const allocationStrategy = useSentinelStore((state) => state.allocationStrategy);
  const setAllocationStrategy = useSentinelStore((state) => state.setAllocationStrategy);
  const liquidPercentage = allocationStrategy;
  const yieldPercentage = 100 - allocationStrategy;

  return (
    <Card className="space-y-6 border-cyan-400/20">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.24em] text-cyan-200">PayFi Splitter</div>
          <h3 className="mt-2 text-balance font-display text-2xl text-white">Allocate live settlement yield</h3>
        </div>
        <div className="w-fit rounded-full border border-white/10 bg-white/5 p-3 text-cyan-200">
          <ArrowRightLeft className="h-5 w-5" />
        </div>
      </div>

      <div className="rounded-[28px] border border-white/10 bg-slate-950/65 p-4 sm:p-5">
          <div className="mb-5 flex flex-col gap-2 text-sm text-slate-300 sm:flex-row sm:items-center sm:justify-between">
          <span>Merchant treasury split</span>
          <span>{liquidPercentage}% / {yieldPercentage}%</span>
        </div>

        <div className="relative h-4 overflow-hidden rounded-full bg-white/10">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cyan-400 to-sky-300"
            style={{ width: `${liquidPercentage}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-r from-emerald-400 to-lime-300"
            style={{ width: `${yieldPercentage}%` }}
          />
        </div>

        <input
          type="range"
          min={0}
          max={100}
          value={liquidPercentage}
          onChange={(event) => setAllocationStrategy(Number(event.target.value))}
          className="mt-5 h-2 w-full cursor-pointer accent-cyan-300"
          aria-label="Liquid USDC allocation"
        />

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-cyan-400/20 bg-cyan-400/10 p-4">
            <div className="flex items-center gap-2 text-cyan-100">
              <Droplets className="h-4 w-4" />
              Liquid USDC
            </div>
            <div className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
              {liquidPercentage}%
            </div>
            <p className="mt-2 text-sm text-cyan-50/80">
              Immediate checkout liquidity kept ready for same-block settlement.
            </p>
          </div>

          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <div className="flex items-center gap-2 text-emerald-100">
              <Landmark className="h-4 w-4" />
              Yield Vault (USDY)
            </div>
            <div className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
              {yieldPercentage}%
            </div>
            <p className="mt-2 text-sm text-emerald-50/80">
              Excess liquidity routed into the RWA lane for passive treasury yield.
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
