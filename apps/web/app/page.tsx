import Link from "next/link";
import { ArrowRight, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { Button, Card } from "../components/ui";

const features = [
  "HashKey Chain L2 checkout with HSK-native settlement",
  "AI Intent Engine that recommends the right spend asset",
  "NexaID-inspired ZK verification for private eligibility checks"
];

export default function HomePage() {
  return (
    <main className="grid-shell min-h-screen px-6 py-8 md:px-10">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex items-center justify-between rounded-full border border-white/10 bg-white/5 px-5 py-3 backdrop-blur">
          <div className="font-display text-lg text-white">SentinelPay AI</div>
          <Link href="/login" className="text-sm text-cyan-200">
            Launch Demo
          </Link>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <Card className="relative overflow-hidden border-cyan-400/20 bg-slate-950/70 p-8 md:p-10">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent" />
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-cyan-200">
              <Sparkles className="h-3.5 w-3.5" />
              Taxonomy meets Magic UI
            </div>
            <h1 className="mt-6 max-w-3xl font-display text-5xl leading-tight text-white md:text-7xl">
              Privacy-first PayFi checkout with AI-native settlement strategy.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300">
              SentinelPay AI is the hackathon front door for merchants who want a polished checkout, smarter spend
              recommendations, and an RWA-aware settlement engine that feels ready for institutional scale.
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
              <Link href="/login">
                <Button className="gap-2">
                  Enter SentinelPay
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button variant="secondary">Open Merchant Portal</Button>
              </Link>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {features.map((feature) => (
                <div key={feature} className="rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                  {feature}
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-6">
            <Card className="animate-float">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-emerald-300" />
                <div>
                  <div className="text-sm text-slate-400">ZKID Track</div>
                  <div className="font-display text-2xl text-white">NexaID-linked flows</div>
                </div>
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                Privacy-preserving verification unlocks discounts, safer access control, and a cleaner story for judges.
              </p>
            </Card>

            <Card className="animate-float [animation-delay:1.4s]">
              <div className="flex items-center gap-3">
                <WalletCards className="h-5 w-5 text-cyan-300" />
                <div>
                  <div className="text-sm text-slate-400">PayFi Track</div>
                  <div className="font-display text-2xl text-white">HSP-inspired settlement</div>
                </div>
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                A portion of each payment can be routed into an RWA vault, showing how real-world asset settlement fits
                directly into an EVM-native payment flow on HashKey Chain.
              </p>
            </Card>
          </div>
        </div>
      </section>
    </main>
  );
}

