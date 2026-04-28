"use client";

import { useEffect, useRef, useState } from "react";
import { animate, motion } from "framer-motion";
import { Activity, Landmark, Wallet } from "lucide-react";
import { useOnChainBalance } from "../../../hooks/useOnChainBalance";
import { Card } from "../../ui";

function AnimatedCurrency({
  value,
  suffix
}: {
  value: number;
  suffix: string;
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const previousValue = useRef(0);

  useEffect(() => {
    const controls = animate(previousValue.current, value, {
      duration: 0.7,
      onUpdate: (latest) => setDisplayValue(latest)
    });

    previousValue.current = value;

    return () => controls.stop();
  }, [value]);

  return (
    <motion.div className="flex flex-wrap items-end gap-x-2 gap-y-1">
      <span className="tabular-nums leading-none">{displayValue.toFixed(2)}</span>
      <span className="pb-0.3 text-sm font-medium uppercase tracking-[0.10em] text-slate-300 sm:text-base">
        {suffix}
      </span>
    </motion.div>
  );
}

export function StatCards() {
  const { data, isFetching } = useOnChainBalance();
  const estimatedYield = data.vaultBalance * 0.041;

  const cards = [
    {
      label: "Total Revenue",
      value: data.totalVolume,
      suffix: "USD",
      icon: Activity,
      accent: "from-cyan-400/25 to-sky-500/10"
    },
    {
      label: "Available USDC",
      value: data.availableUsdc,
      suffix: "USDC",
      icon: Wallet,
      accent: "from-blue-400/20 to-cyan-500/10"
    },
    {
      label: "Yield Earned",
      value: estimatedYield,
      suffix: "USD",
      icon: Landmark,
      accent: "from-emerald-400/25 to-lime-400/10"
    }
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {cards.map(({ label, value, suffix, icon: Icon, accent }) => (
        <Card
          key={label}
          className={`min-w-0 overflow-hidden border-white/10 bg-gradient-to-br ${accent}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="max-w-[12ch] text-xs uppercase tracking-[0.18em] text-slate-300 sm:max-w-none">
                {label}
              </div>
              <div className="mt-3 text-[2rem] font-semibold leading-none text-white sm:text-[2.35rem]">
                <AnimatedCurrency value={value} suffix={suffix} />
              </div>
            </div>
            <div className={`rounded-full border border-white/10 bg-white/10 p-3 text-white ${label === "Yield Earned" ? "animate-pulse" : ""}`}>
              <Icon className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-5 text-xs uppercase tracking-[0.14em] text-slate-300">
            {isFetching ? "Refreshing from Solana..." : `Updated ${new Date(data.updatedAt).toLocaleTimeString()}`}
          </div>
        </Card>
      ))}
    </div>
  );
}
