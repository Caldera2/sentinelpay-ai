import Link from "next/link";
import { ArrowRight, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { Button, Card } from "../components/ui";

const features = [
  "Solana-native checkout with USDC treasury settlement",
  "Jupiter-powered swap-to-pay for any supported wallet asset",
  "AI-guided treasury split between liquid USDC and Ondo USDY yield"
];

export default function HomePage() {
  return (
    <main className="grid-shell min-h-screen px-4 py-6 sm:px-6 md:px-8 md:py-8 xl:px-10">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 md:gap-8">
        <header className="flex flex-col gap-3 rounded-[28px] border border-white/10 bg-white/5 px-4 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:rounded-full sm:px-5 sm:py-3">
          <div className="font-display text-base text-white sm:text-lg">SentinelPay AI</div>
          <Link href="/login" className="text-sm text-cyan-200">
            Launch Demo
          </Link>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] lg:gap-8">
          <Card className="relative overflow-hidden border-cyan-400/20 bg-slate-950/70 p-5 sm:p-7 md:p-10">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent" />
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-cyan-200">
              <Sparkles className="h-3.5 w-3.5" />
              Solana PayFi
            </div>
            <h1 className="mt-5 max-w-3xl font-display text-4xl leading-tight text-white sm:text-5xl md:mt-6 md:text-7xl">
              Treasury-grade Solana checkout with live yield allocation.
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base sm:leading-8 md:mt-6">
              SentinelPay AI gives merchants a polished Solana payment surface, instant USDC settlement, and a
              treasury cockpit that routes idle balances into yield-bearing RWAs without sacrificing checkout speed.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:gap-4">
              <Link href="/login">
                <Button className="w-full gap-2 sm:w-auto">
                  Enter SentinelPay
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button variant="secondary" className="w-full sm:w-auto">Open Merchant Portal</Button>
              </Link>
            </div>

            <div className="mt-8 grid gap-4 md:mt-10 md:grid-cols-3">
              {features.map((feature) => (
                <div key={feature} className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                  {feature}
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-5 md:gap-6">
            <Card className="animate-float">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-emerald-300" />
                <div>
                  <div className="text-sm text-slate-400">ZKID Track</div>
                  <div className="font-display text-2xl text-white">Shielded intent controls</div>
                </div>
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                Privacy-preserving toggles let merchants present compliance-friendly controls without exposing raw
                blockchain complexity in the user experience.
              </p>
            </Card>

            <Card className="animate-float [animation-delay:1.4s]">
              <div className="flex items-center gap-3">
                <WalletCards className="h-5 w-5 text-cyan-300" />
                <div>
                  <div className="text-sm text-slate-400">PayFi Track</div>
                  <div className="font-display text-2xl text-white">Solana treasury automation</div>
                </div>
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                A portion of each settlement can flow from liquid USDC into Ondo USDY, showing how RWAs slot cleanly
                into an institutional Solana payment stack.
              </p>
            </Card>
          </div>
        </div>
      </section>
    </main>
  );
}

