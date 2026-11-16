import Link from "next/link";
import { Card } from "../components/ui";

export default function HomePage() {
  return (
    <main className="grid-shell min-h-screen px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="flex items-center justify-between rounded-full border border-white/10 bg-white/5 px-6 py-4">
          <span className="text-lg font-semibold">SentinelPay</span>
          <Link href="/login" className="text-sm text-cyan-200">
            Merchant sign in
          </Link>
        </header>
        <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <Card className="border-cyan-400/20 p-6 sm:p-10">
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-200">
              Solana payments · merchant treasury
            </p>
            <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight sm:text-6xl">
              Get paid in USDC.
              <br />
              Keep your operating cash ready.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300">
              Create payment links with fixed invoice amounts, verify settlement
              on Solana, and plan how much cash your business needs to keep
              available.
            </p>
            <Link
              href="/login"
              className="mt-8 inline-flex rounded-2xl bg-cyan-300 px-6 py-3 font-semibold text-slate-950"
            >
              Open merchant dashboard
            </Link>
            <p className="mt-5 text-sm text-slate-400">
              Connect a Solana wallet and sign a message to get started. The
              configured network is shown before every payment.
            </p>
          </Card>
          <div className="grid gap-6">
            <Card>
              <h2 className="text-xl font-semibold">
                One link. A clear invoice.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                Customers see what they’re paying for, the exact USDC amount,
                and your recipient wallet. Receipts are verified against
                finalized on-chain transactions.
              </p>
            </Card>
            <Card>
              <h2 className="text-xl font-semibold">
                Your wallet stays in control.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                Set a cash reserve policy based on your operating needs.
                Optional treasury trading requires a supported provider,
                eligibility review, and your wallet’s approval.
              </p>
            </Card>
          </div>
        </section>
        <section className="grid gap-5 md:grid-cols-3">
          {[
            {
              title: "Payment links",
              text: "Create and share invoices with an amount, description, and expiry.",
            },
            {
              title: "Verified reporting",
              text: "Review settled invoices, inspect receipts, and export payment records.",
            },
            {
              title: "Cash reserve planning",
              text: "Use live USDC balances, upcoming expenses, and saved allocation limits.",
            },
          ].map((item) => (
            <Card key={item.title}>
              <h2 className="font-semibold">{item.title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                {item.text}
              </p>
            </Card>
          ))}
        </section>
      </div>
    </main>
  );
}
